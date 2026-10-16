import { defineCommand, type Actor } from '@kete/commands';
import { currentPolicies, readDecisions, savePolicy } from '@kete/policies';
import { newId } from '@kete/records';
import type { Gesture, Policy } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { decideFor, engine, GestureError, policyCounts } from '../policies/index.js';

// The organization's rules for its agents (spec 068, doctrine D-043), as policies of the one
// engine (spec 088, D-058): a rule is a form an administrator fills — a family, a sentence, the
// permissions it covers — that writes a Cedar policy in the authority set. It is applied where an
// agent calls a capability (`capability.use`, the gateway); each decision is journaled with the
// policy that made it. A rule is born on trial: it refuses nothing yet, the journal counts what it
// would have refused; it is switched on once it was tried on the last month.

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

/** The rules' first tables (migration 0054); spec 088 moves their state and journal to policies. */
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
  /** Its policy's status. */
  state: RuleState;
  /** Its policy's version. */
  version: number;
  simulatedAt: string | null;
  createdAt: string;
}

type FormRow = {
  rule_id: string;
  family: RuleFamily;
  sentence: string;
  effect: RuleEffect;
  permissions: string[];
  simulated_at: Date | null;
  created_at: Date;
};
const COLUMNS = 'rule_id, family, sentence, effect, permissions, simulated_at, created_at';
const ruleOf = (r: FormRow, policy: Policy | undefined): Rule => ({
  ruleId: r.rule_id,
  family: r.family,
  sentence: r.sentence,
  effect: r.effect,
  permissions: r.permissions,
  state: policy?.status ?? 'off',
  version: policy?.version ?? 0,
  simulatedAt: r.simulated_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

export async function listRules(db: SqlExecutor): Promise<Rule[]> {
  const policies = new Map((await currentPolicies(db)).map((p) => [p.id, p]));
  const { rows } = await db.query<FormRow>(
    `select ${COLUMNS} from ai_rules order by created_at, rule_id`,
  );
  return rows.map((row) => ruleOf(row, policies.get(row.rule_id)));
}

/** A capability an agent is about to use: its permission, and whether it acts alone (level 2). */
export interface CapabilityUse {
  permission: string;
  autonomy: number;
}

/**
 * A rule's policy, in Cedar: `tools` forbids its permissions to agents; `autonomy` (« person »)
 * forbids an agent to act alone (level 2) on them — reading (1) and preparing a draft a person
 * decides (3, 4) are not acting alone. No permission: all of them. The migration writes the same.
 */
export function ruleText(rule: Pick<Rule, 'effect' | 'permissions'>): string {
  const head =
    'forbid (principal is Kete::Agent, action == Kete::Action::"capability.use", resource)';
  const conditions = [
    ...(rule.effect === 'person' ? ['context.autonomy == 2'] : []),
    ...(rule.permissions.length > 0
      ? [`[${rule.permissions.map((p) => `"${p}"`).join(', ')}].contains(context.permission)`]
      : []),
  ];
  return conditions.length > 0 ? `${head} when { ${conditions.join(' && ')} };` : `${head};`;
}

/** An agent about to use a capability, as the gesture the engine decides. */
export function capabilityGesture(call: CapabilityUse & { actor: Actor; tool: string }): Gesture {
  return {
    actor: {
      kind: 'agent',
      id: call.actor.id,
      ...(call.actor.onBehalfOf ? { on_behalf_of: call.actor.onBehalfOf.id } : {}),
    },
    kind: 'capability.use',
    object: { kind: 'capability', id: call.tool },
    channel: call.actor.channel,
    context: { permission: call.permission, autonomy: call.autonomy },
    at: new Date().toISOString(),
  };
}

/** What refused a gesture: the policy and its sentence. */
export interface Refusing {
  ruleId: string;
  sentence: string;
}

/**
 * The single point of passage: an agent is about to use a capability. The engine decides it under
 * the organization's policies — its rules among them — and journals the decision; a refusal names
 * the policy that refused, a policy on trial only counts. A capability that needs someone's
 * approval is not used alone either. People are not agents: their own gestures never pass here.
 */
export async function ruleAgainst(
  db: SqlExecutor,
  organizationId: string,
  call: CapabilityUse & { actor: Actor; tool: string },
): Promise<Refusing | null> {
  if (call.actor.kind !== 'agent') return null;
  try {
    const decision = await decideFor(db, organizationId, capabilityGesture(call));
    if (decision.effect === 'allow') return null;
    const cited = decision.policies[0];
    return cited ? { ruleId: cited.id, sentence: cited.reason } : null;
  } catch (error) {
    if (error instanceof GestureError) return { ruleId: error.code, sentence: error.message };
    throw error;
  }
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

/** The journal of refusals by the rules, the latest first: the evidence that a rule held. */
export async function refusals(db: SqlExecutor, limit = 100): Promise<Refusal[]> {
  const rules = new Set((await listRules(db)).map((rule) => rule.ruleId));
  const { rows: agents } = await db.query<{ agent_id: string; name: string }>(
    `select agent_id, name from agents`,
  );
  const names = new Map(agents.map((a) => [a.agent_id, a.name]));
  const found: Refusal[] = [];
  for (const decision of await readDecisions(db, { limit: 500 })) {
    const { gesture } = decision;
    if (gesture.kind !== 'capability.use') continue;
    const cited = [
      ...decision.policies.filter((p) => p.effect === 'refuse').map((p) => ({ p, trial: false })),
      ...decision.trial.map((p) => ({ p, trial: true })),
    ].filter(({ p }) => rules.has(p.id));
    for (const { p, trial } of cited) {
      found.push({
        refusalId: `${decision.decisionId}:${p.id}`,
        ruleId: p.id,
        rule: p.reason,
        trial,
        agentId: gesture.actor.id,
        agentName: names.get(gesture.actor.id) ?? null,
        onBehalfOf: gesture.actor.on_behalf_of ?? null,
        channel: gesture.channel ?? '',
        tool: gesture.object.id,
        permission: String(gesture.context?.permission ?? ''),
        at: decision.at.toISOString(),
      });
    }
  }
  return found.slice(0, limit);
}

/** How many times each rule refused, and counted on trial, these last thirty days. */
export async function lastMonth(
  db: SqlExecutor,
): Promise<Map<string, { refused: number; counted: number }>> {
  const counts = await policyCounts(db);
  return new Map([...counts].map(([id, c]) => [id, { refused: c.refused, counted: c.trial }]));
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
 * permission and its level (spec 056) — how many the engine would have refused with it switched
 * on, the other active policies as they are. Nothing is journaled.
 */
export async function simulate(db: SqlExecutor, ruleId: string): Promise<Simulation | null> {
  const policies = await currentPolicies(db);
  const policy = policies.find((p) => p.id === ruleId);
  const { rows: forms } = await db.query<{ rule_id: string }>(
    `select rule_id from ai_rules where rule_id = $1`,
    [ruleId],
  );
  if (!forms[0] || !policy) return null;
  const tried = [
    ...policies.filter((p) => p.id !== ruleId && p.status === 'active'),
    { ...policy, status: 'active' as const },
  ];
  const { rows } = await db.query<{
    agent_id: string;
    name: string;
    responsible_user_id: string | null;
    autonomy_max: number;
    tool: string;
    permission: string | null;
    level: number | null;
    created_at: Date;
  }>(
    `select a.agent_id, a.name, a.responsible_user_id, a.autonomy_max, step->>'tool' as tool,
            step->>'permission' as permission, (step->>'level')::int as level, t.created_at
       from agent_tasks t
       join agents a on a.agent_id = t.agent_id
       cross join lateral jsonb_array_elements(t.steps) as step
      where t.created_at >= now() - interval '30 days'
        and step->>'status' in ('done', 'draft')
      order by t.created_at desc`,
  );
  const taken = rows.filter((r) => r.permission !== null && r.level !== null);
  const hit = taken.filter((r) => {
    const person = r.responsible_user_id ?? '';
    const decision = engine.decide({
      policies: tried,
      gesture: capabilityGesture({
        actor: {
          kind: 'agent',
          id: r.agent_id,
          channel: 'worker',
          ...(person ? { onBehalfOf: { kind: 'person', id: person } } : {}),
        },
        tool: r.tool,
        permission: r.permission ?? '',
        autonomy: r.level ?? 0,
      }),
      // The agent as the engine reads it; a rule reads only the capability and its level.
      entities: [
        {
          uid: { type: 'Kete::Agent', id: r.agent_id },
          attrs: {
            onBehalfOf: { __entity: { type: 'Kete::Person', id: person } },
            autonomyMax: r.autonomy_max,
          },
          parents: [],
        },
      ],
    });
    return decision.effect !== 'allow' && decision.policies.some((p) => p.id === ruleId);
  });
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

/** A rule is written, and its policy with it: on trial, it refuses nothing yet. */
export const createRule = defineCommand({
  name: 'create-ai-rule',
  input: createRuleInput,
  reversibility: { reversible: true, inverse: 'set-ai-rule-state' },
  async handler(input, { db, organizationId, actor }) {
    if (!(appliedFamilies as readonly string[]).includes(input.family)) {
      throw new RuleError('family_later', 'This family is not applied by a rule yet.');
    }
    // Tools: no agent uses them. Autonomy: no agent acts alone on them.
    const effect: RuleEffect = input.family === 'tools' ? 'forbid' : 'person';
    const permissions = [...new Set(input.permissions)].sort();
    const { rows } = await db.query<FormRow>(
      `insert into ai_rules (organization_id, rule_id, family, sentence, effect, permissions,
         created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning ${COLUMNS}`,
      [organizationId, newId('rul'), input.family, input.sentence, effect, permissions, actor.id],
    );
    const form = rows[0] as FormRow;
    const policy = await savePolicy(db, organizationId, engine, {
      id: form.rule_id,
      sentence: form.sentence,
      rule: ruleText({ effect, permissions }),
      set: 'authority',
      owner: actor.id,
      status: 'trial',
      writtenBy: actor.id,
    });
    return ruleOf(form, policy);
  },
  summarize: (input) => `Rule on trial: ${input.sentence}`,
});

export const ruleStateInput = z.object({
  ruleId: z.string().regex(/^rul_[0-9a-f-]{8,64}$/),
  state: z.enum(['trial', 'active', 'off']),
});

/**
 * A rule is switched on — only once it was tried on the last month — put back on trial, or off:
 * each time a new version of its policy.
 */
export const setRuleState = defineCommand({
  name: 'set-ai-rule-state',
  input: ruleStateInput,
  reversibility: { reversible: true, inverse: 'set-ai-rule-state' },
  async handler(input, { db, organizationId, actor }) {
    const { rows } = await db.query<FormRow>(
      `select ${COLUMNS} from ai_rules where rule_id = $1 for update`,
      [input.ruleId],
    );
    const form = rows[0];
    const policy = (await currentPolicies(db)).find((p) => p.id === input.ruleId);
    if (!form || !policy) throw new RuleError('not_found', 'No such rule here.');
    if (input.state === 'active' && !form.simulated_at) {
      throw new RuleError('not_tried', 'Try it on the last month before switching it on.');
    }
    await savePolicy(db, organizationId, engine, {
      id: policy.id,
      sentence: policy.sentence,
      rule: policy.rule,
      set: policy.set,
      owner: policy.owner,
      status: input.state,
      writtenBy: actor.id,
    });
    await db.query('update ai_rules set updated_at = now() where rule_id = $1', [input.ruleId]);
    return {
      ruleId: form.rule_id,
      sentence: form.sentence,
      before: policy.status,
      state: input.state,
    };
  },
  summarize: (input, output) => `Rule ${output.state}: ${output.sentence}`,
});
