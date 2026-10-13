import { defineCommand, type Actor } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// The organization's rules for its agents (spec 068, doctrine D-043): each one is a sentence an
// administrator wrote, applied at a single point of passage — where an agent calls a capability
// (the gateway). A refusal is journaled with the rule that refused. A rule is born on trial: it
// refuses nothing yet, it counts what it would have refused; it is switched on once it was tried
// on the last month.

/** The eight families (D-043). Two are applied here; the others are settled elsewhere for now. */
export const ruleFamilies = [
  'data',
  'models',
  'tools',
  'autonomy',
  'retention',
  'transparency',
  'budgets',
  'exit',
] as const;
export type RuleFamily = (typeof ruleFamilies)[number];

/** `forbid`: no agent uses these capabilities. `person`: no agent acts alone on them. */
export type RuleEffect = 'forbid' | 'person';
export type RuleState = 'trial' | 'active' | 'off';

export function rulesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.ai_rules (
  organization_id text not null,
  rule_id text not null,
  family text not null check (family in
    ('data', 'models', 'tools', 'autonomy', 'retention', 'transparency', 'budgets', 'exit')),
  sentence text not null check (length(sentence) between 3 and 300),
  effect text not null check (effect in ('forbid', 'person')),
  -- The permissions it covers; none for all of them.
  permissions text[] not null default '{}',
  state text not null check (state in ('trial', 'active', 'off')),
  -- When it was last tried on the past month: it is not switched on before.
  simulated_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, rule_id)
);
${policy('ai_rules')}
grant select, insert, update on ${s}.ai_rules to ${options.appRole};

-- What a rule refused, or would have while on trial: written once, never changed.
create table ${s}.ai_rule_refusals (
  organization_id text not null,
  refusal_id text not null,
  rule_id text not null,
  rule_sentence text not null,
  trial boolean not null,
  agent_id text not null,
  on_behalf_of text,
  channel text not null,
  tool text not null,
  permission text not null,
  trace_id text,
  at timestamptz not null default now(),
  primary key (organization_id, refusal_id)
);
create index ai_rule_refusals_at on ${s}.ai_rule_refusals (organization_id, at desc);
${policy('ai_rule_refusals')}
grant select, insert on ${s}.ai_rule_refusals to ${options.appRole};
revoke update, delete on ${s}.ai_rule_refusals from ${options.appRole};
`;
}

export interface Rule {
  ruleId: string;
  family: RuleFamily;
  sentence: string;
  effect: RuleEffect;
  permissions: string[];
  state: RuleState;
  simulatedAt: string | null;
  createdAt: string;
}

type RuleRow = {
  rule_id: string;
  family: RuleFamily;
  sentence: string;
  effect: RuleEffect;
  permissions: string[];
  state: RuleState;
  simulated_at: Date | null;
  created_at: Date;
};
const COLUMNS = 'rule_id, family, sentence, effect, permissions, state, simulated_at, created_at';
const ruleOf = (r: RuleRow): Rule => ({
  ruleId: r.rule_id,
  family: r.family,
  sentence: r.sentence,
  effect: r.effect,
  permissions: r.permissions,
  state: r.state,
  simulatedAt: r.simulated_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

export async function listRules(db: SqlExecutor): Promise<Rule[]> {
  const { rows } = await db.query<RuleRow>(
    `select ${COLUMNS} from ai_rules order by created_at, rule_id`,
  );
  return rows.map(ruleOf);
}

/** What a capability is, for a rule: its permission, and whether it acts alone (level 2). */
export interface Gesture {
  permission: string;
  autonomy: number;
}

/** Whether a rule covers a gesture: its permissions, and — for « person » — acting alone only. */
export function covers(rule: Pick<Rule, 'effect' | 'permissions'>, gesture: Gesture): boolean {
  if (rule.permissions.length > 0 && !rule.permissions.includes(gesture.permission)) return false;
  // Reading (1) and preparing a draft a person decides (3, 4) are not acting alone.
  return rule.effect === 'forbid' || gesture.autonomy === 2;
}

/**
 * The single point of passage: an agent is about to use a capability. The first active rule that
 * covers it refuses, and the refusal is journaled with the rule; a rule on trial only counts.
 * People are not agents: a rule never refuses a person's own gesture.
 */
export async function ruleAgainst(
  db: SqlExecutor,
  organizationId: string,
  call: Gesture & { actor: Actor; tool: string },
): Promise<Rule | null> {
  if (call.actor.kind !== 'agent') return null;
  const rules = (await listRules(db)).filter((rule) => rule.state !== 'off' && covers(rule, call));
  let refusing: Rule | null = null;
  for (const rule of rules) {
    if (rule.state === 'active' && refusing) continue;
    if (rule.state === 'active') refusing = rule;
    await db.query(
      `insert into ai_rule_refusals (organization_id, refusal_id, rule_id, rule_sentence, trial,
         agent_id, on_behalf_of, channel, tool, permission, trace_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        organizationId,
        newId('rfs'),
        rule.ruleId,
        rule.sentence,
        rule.state === 'trial',
        call.actor.id,
        call.actor.onBehalfOf?.id ?? null,
        call.actor.channel,
        call.tool,
        call.permission,
        call.actor.traceId ?? null,
      ],
    );
  }
  return refusing;
}

export interface Refusal {
  refusalId: string;
  ruleId: string;
  rule: string;
  trial: boolean;
  agentId: string;
  /** Its name; none for the assistant and for a copilot through the gateway. */
  agentName: string | null;
  onBehalfOf: string | null;
  channel: string;
  tool: string;
  permission: string;
  at: string;
}

/** The journal of refusals, the latest first: the evidence that a rule held. */
export async function refusals(db: SqlExecutor, limit = 100): Promise<Refusal[]> {
  const { rows } = await db.query<{
    refusal_id: string;
    rule_id: string;
    rule_sentence: string;
    trial: boolean;
    agent_id: string;
    agent_name: string | null;
    on_behalf_of: string | null;
    channel: string;
    tool: string;
    permission: string;
    at: Date;
  }>(
    `select r.refusal_id, r.rule_id, r.rule_sentence, r.trial, r.agent_id, a.name as agent_name,
            r.on_behalf_of, r.channel, r.tool, r.permission, r.at
       from ai_rule_refusals r left join agents a on a.agent_id = r.agent_id
      order by r.at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    refusalId: r.refusal_id,
    ruleId: r.rule_id,
    rule: r.rule_sentence,
    trial: r.trial,
    agentId: r.agent_id,
    agentName: r.agent_name,
    onBehalfOf: r.on_behalf_of,
    channel: r.channel,
    tool: r.tool,
    permission: r.permission,
    at: r.at.toISOString(),
  }));
}

/** How many times each rule refused, and counted on trial, these last thirty days. */
export async function lastMonth(
  db: SqlExecutor,
): Promise<Map<string, { refused: number; counted: number }>> {
  const { rows } = await db.query<{ rule_id: string; refused: string; counted: string }>(
    `select rule_id, count(*) filter (where not trial) as refused,
            count(*) filter (where trial) as counted
       from ai_rule_refusals where at >= now() - interval '30 days' group by rule_id`,
  );
  return new Map(
    rows.map((r) => [r.rule_id, { refused: Number(r.refused), counted: Number(r.counted) }]),
  );
}

export interface Simulation {
  days: number;
  /** The steps agents took over the period, each with its permission and its level. */
  steps: number;
  /** Those this rule would have refused. */
  refused: number;
  examples: { agent: string; tool: string; at: string }[];
}

/**
 * A rule tried on the last month: over the steps agents really took — each recorded with its
 * permission and its level (spec 056) — how many it would have refused. Counted by code.
 */
export async function simulate(db: SqlExecutor, ruleId: string): Promise<Simulation | null> {
  const found = await db.query<RuleRow>(`select ${COLUMNS} from ai_rules where rule_id = $1`, [
    ruleId,
  ]);
  if (!found.rows[0]) return null;
  const rule = ruleOf(found.rows[0]);
  const { rows } = await db.query<{
    name: string;
    tool: string;
    permission: string | null;
    level: number | null;
    created_at: Date;
  }>(
    `select a.name, step->>'tool' as tool, step->>'permission' as permission,
            (step->>'level')::int as level, t.created_at
       from agent_tasks t
       join agents a on a.agent_id = t.agent_id
       cross join lateral jsonb_array_elements(t.steps) as step
      where t.created_at >= now() - interval '30 days'
        and step->>'status' in ('done', 'draft')
      order by t.created_at desc`,
  );
  const taken = rows.filter((r) => r.permission !== null && r.level !== null);
  const hit = taken.filter((r) =>
    covers(rule, { permission: r.permission ?? '', autonomy: r.level ?? 0 }),
  );
  await db.query('update ai_rules set simulated_at = now() where rule_id = $1', [ruleId]);
  return {
    days: 30,
    steps: taken.length,
    refused: hit.length,
    examples: hit
      .slice(0, 5)
      .map((r) => ({ agent: r.name, tool: r.tool, at: r.created_at.toISOString() })),
  };
}

/** A rule of the rules was not met: the change is refused, nothing is written. */
export class RuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_tried' | 'family_later' | 'unknown_permission',
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

/** The families a rule can be written in today: those applied where an agent calls a capability. */
export const appliedFamilies = ['tools', 'autonomy'] as const;

export const createRuleInput = z
  .object({
    family: z.enum(ruleFamilies),
    sentence: z.string().trim().min(3).max(300),
    permissions: z
      .array(z.string().regex(/^[a-z]+:[a-z_]+$/))
      .max(50)
      .default([]),
  })
  .refine((rule) => rule.family !== 'tools' || rule.permissions.length > 0, {
    message: 'A rule on tools names what it forbids.',
  });

/** A rule is written: on trial, it refuses nothing yet. */
export const createRule = defineCommand({
  name: 'create-ai-rule',
  input: createRuleInput,
  reversibility: { reversible: true, inverse: 'set-ai-rule-state' },
  async handler(input, { db, organizationId, actor }) {
    if (!(appliedFamilies as readonly string[]).includes(input.family)) {
      throw new RuleError('family_later', 'This family is not applied by a rule yet.');
    }
    const { rows } = await db.query<RuleRow>(
      `insert into ai_rules (organization_id, rule_id, family, sentence, effect, permissions,
         state, created_by)
       values ($1, $2, $3, $4, $5, $6, 'trial', $7) returning ${COLUMNS}`,
      [
        organizationId,
        newId('rul'),
        input.family,
        input.sentence,
        // Tools: no agent uses them. Autonomy: no agent acts alone on them.
        input.family === 'tools' ? 'forbid' : 'person',
        [...new Set(input.permissions)].sort(),
        actor.id,
      ],
    );
    return ruleOf(rows[0] as RuleRow);
  },
  summarize: (input) => `Rule on trial: ${input.sentence}`,
});

export const ruleStateInput = z.object({
  ruleId: z.string().regex(/^rul_[0-9a-f-]{8,64}$/),
  state: z.enum(['trial', 'active', 'off']),
});

/** A rule is switched on — only once it was tried on the last month — put back on trial, or off. */
export const setRuleState = defineCommand({
  name: 'set-ai-rule-state',
  input: ruleStateInput,
  reversibility: { reversible: true, inverse: 'set-ai-rule-state' },
  async handler(input, { db }) {
    const { rows } = await db.query<RuleRow>(
      `select ${COLUMNS} from ai_rules where rule_id = $1 for update`,
      [input.ruleId],
    );
    const rule = rows[0] ? ruleOf(rows[0]) : null;
    if (!rule) throw new RuleError('not_found', 'No such rule here.');
    if (input.state === 'active' && !rule.simulatedAt) {
      throw new RuleError('not_tried', 'Try it on the last month before switching it on.');
    }
    await db.query('update ai_rules set state = $2, updated_at = now() where rule_id = $1', [
      input.ruleId,
      input.state,
    ]);
    return { ruleId: rule.ruleId, sentence: rule.sentence, before: rule.state, state: input.state };
  },
  summarize: (input, output) => `Rule ${output.state}: ${output.sentence}`,
});
