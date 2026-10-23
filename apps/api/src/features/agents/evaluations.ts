import { evaluateAgent, type EvaluationCase, type EvaluationReport } from '@kete/agents';
import type { CapabilityTool, InvocationResult } from '@kete/capabilities';
import type { Actor } from '@kete/commands';
import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { getPool, transaction } from '../../platform/db.js';
import { organizationLanguageModel } from '../../platform/models.js';
import { toolsForAgent } from '../gateway/index.js';
import type { Agent } from './agents.record.js';
import { findAgent, personOfAgent } from './infrastructure/agents.tables.js';
import { agentToolSets } from './toolsets.js';

// An agent proves itself (spec 106; doctrine D-062, R21; kete-core ADR 0018): a test set — what
// its person accepted of its past work, and the cases she wrote — replayed with her rights after
// any change of its job description. Its tools are played dry: nothing is done, only what it
// chose is judged — the gesture it prepares, what it must never say. Under its threshold, it is
// paused « à revoir », and its person is told why; its score shows in its record.

export function evaluationsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.agent_eval_cases (
  organization_id text not null,
  case_id text not null,
  agent_id text not null,
  name text not null check (length(name) between 1 and 120),
  ask text not null check (length(ask) between 1 and 2000),
  -- What must hold: the gestures it prepares, what it must never say.
  expect jsonb not null,
  written_by text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, case_id)
);
${policy('agent_eval_cases')}
grant select, insert, delete on ${s}.agent_eval_cases to ${options.appRole};

create table ${s}.agent_evaluations (
  organization_id text not null,
  evaluation_id text not null,
  agent_id text not null,
  -- Why it ran: its job changed, or its person asked.
  because text not null check (because in ('job_changed', 'asked')),
  status text not null check (status in ('waiting', 'passed', 'failed', 'unavailable')),
  score numeric check (score between 0 and 1),
  cases integer,
  failures jsonb not null default '[]'::jsonb,
  asked_at timestamptz not null default now(),
  ran_at timestamptz,
  primary key (organization_id, evaluation_id)
);
create index agent_evaluations_agent on ${s}.agent_evaluations (organization_id, agent_id, asked_at desc);
${policy('agent_evaluations')}
grant select, insert, update on ${s}.agent_evaluations to ${options.appRole};

create function ${s}.agent_evaluations_waiting() returns table (organization_id text, evaluation_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, evaluation_id from agent_evaluations where status = 'waiting' $$;
revoke all on function ${s}.agent_evaluations_waiting() from public;
grant execute on function ${s}.agent_evaluations_waiting() to ${options.appRole};
`;
}

/** The share of its cases an agent must pass to keep working. */
export const THRESHOLD = 0.8;

/** An evaluation asked: the worker runs it. */
export async function askEvaluation(
  db: SqlExecutor,
  organizationId: string,
  agentId: string,
  because: 'job_changed' | 'asked',
): Promise<string> {
  const id = newId('evl');
  await db.query(
    `insert into agent_evaluations (organization_id, evaluation_id, agent_id, because, status)
     values ($1, $2, $3, $4, 'waiting')`,
    [organizationId, id, agentId, because],
  );
  return id;
}

/** Its test set: the cases its person wrote, and what she accepted of its work lately. */
export async function casesOf(db: SqlExecutor, agentId: string): Promise<EvaluationCase[]> {
  const { rows: written } = await db.query<{
    name: string;
    ask: string;
    expect: { prepares?: string[]; neverSays?: string[] };
  }>(`select name, ask, expect from agent_eval_cases where agent_id = $1 order by created_at`, [
    agentId,
  ]);
  // What its person accepted: a task whose drafts she validated, and the gesture it prepared.
  const { rows: accepted } = await db.query<{ instruction: string; capability: string }>(
    `select distinct on (s.step->>'tool') t.instruction, s.step->>'tool' as capability
       from agent_tasks t, jsonb_array_elements(t.steps) as s(step)
      where t.agent_id = $1 and s.step->>'status' = 'draft'
        and exists (select 1 from kete_drafts d
                     where d.draft_id = any(t.draft_ids) and d.status = 'validated')
      order by s.step->>'tool', t.created_at desc limit 20`,
    [agentId],
  );
  return [
    ...written.map((w) => ({
      name: w.name,
      messages: [{ role: 'user' as const, content: w.ask }],
      expect: {
        ...(w.expect.prepares?.length ? { prepares: w.expect.prepares } : {}),
        ...(w.expect.neverSays?.length
          ? { neverSays: w.expect.neverSays.map((p) => new RegExp(escape(p), 'i')) }
          : {}),
      },
    })),
    ...accepted.map((a) => ({
      name: a.instruction.slice(0, 80),
      messages: [{ role: 'user' as const, content: a.instruction }],
      expect: { prepares: [a.capability] },
    })),
  ];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Its tools, played dry: a read answers nothing, a gesture is « prepared » — nothing is done. */
function dry(tools: CapabilityTool[]): CapabilityTool[] {
  return tools.map((tool) => ({
    ...tool,
    async execute(input): Promise<InvocationResult> {
      if (tool.autonomy < 3) return { status: 'done', output: { evaluation: true } };
      const draftId = `dry_${tool.name}`;
      return {
        status: 'draft',
        draftId,
        message: 'prepared (evaluation)',
        review: {
          draftId,
          capability: tool.name,
          description: tool.description,
          autonomy: tool.autonomy >= 4 ? 4 : 3,
          recordType: 'evaluation',
          status: 'prepared',
          values: (input ?? {}) as Record<string, unknown>,
          provenance: {},
          schema: tool.jsonSchema,
        },
      };
    },
  }));
}

let modelOverride: LanguageModel | null | undefined;
/** Tests: evaluate with another model (null: none). */
export function useEvaluationModel(model: LanguageModel | null | undefined): void {
  modelOverride = model;
}

/** Runs one waiting evaluation; under its threshold the agent is paused « à revoir ». */
export async function runEvaluation(
  organizationId: string,
  evaluationId: string,
): Promise<EvaluationReport['passed'] | null> {
  const prepared = await transaction(organizationId, async (db) => {
    const { rows } = await db.query<{ agent_id: string }>(
      `update agent_evaluations set status = 'unavailable', ran_at = now()
        where evaluation_id = $1 and status = 'waiting' returning agent_id`,
      [evaluationId],
    );
    const agentId = rows[0]?.agent_id;
    if (!agentId) return null;
    const agent = await findAgent(db, agentId);
    const person = agent ? await personOfAgent(db, agent) : null;
    return agent && person ? { agent, person, cases: await casesOf(db, agentId) } : null;
  });
  if (!prepared) return null;
  const { agent, person, cases } = prepared;
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  // Nothing to judge it on, or no model: it stays as it was, and says so.
  if (!model || cases.length === 0) return null;
  const report = await play(organizationId, agent, person, model, cases);
  await transaction(organizationId, async (db) => {
    await db.query(
      `update agent_evaluations set status = $2, score = $3, cases = $4, failures = $5, ran_at = now()
        where evaluation_id = $1`,
      [
        evaluationId,
        report.passed ? 'passed' : 'failed',
        report.score,
        report.cases.length,
        JSON.stringify(
          report.cases
            .filter((c) => !c.passed)
            .map((c) => ({ name: c.name, failures: c.failures })),
        ),
      ],
    );
    // Not proven: it waits, paused, until its person reviews what failed.
    if (!report.passed) {
      await db.query(`update agents set status = 'paused' where agent_id = $1`, [agent.agentId]);
    }
  });
  return report.passed;
}

async function play(
  organizationId: string,
  agent: Agent,
  userId: string,
  model: LanguageModel,
  cases: EvaluationCase[],
): Promise<EvaluationReport> {
  const person = { organizationId, userId };
  const identity = {
    ...person,
    email: '',
    name: '',
    role: null,
    apps: {},
    twoFactor: false,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  };
  const actor: Actor = {
    kind: 'agent',
    id: agent.agentId,
    channel: 'worker',
    onBehalfOf: { kind: 'person', id: userId },
  };
  return asPerson(identity, async () => {
    const own = agent.sources.includes('kete')
      ? await toolsForAgent(person, actor, {
          permissions: agent.permissions,
          autonomyMax: agent.autonomyMax,
          autonomyByPermission: agent.autonomyByPermission,
          draftBudget: agent.draftBudget,
        })
      : [];
    const sets = await agentToolSets(identity, {
      sources: agent.sources,
      autonomyMax: agent.autonomyMax,
    });
    return evaluateAgent({
      turn: {
        agent: agent.agentId,
        name: agent.name,
        model,
        instructions: `Tu es ${agent.name}, un agent de Kete Enterprise. Ta mission : ${agent.mission}`,
        tools: dry([...own, ...sets]),
        maxSteps: 4,
      },
      cases,
      threshold: THRESHOLD,
    });
  });
}

/** The worker: every evaluation waiting, one after the other. */
export async function runWaitingEvaluations(): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string; evaluation_id: string }>(
    'select organization_id, evaluation_id from agent_evaluations_waiting()',
  );
  let ran = 0;
  for (const row of rows) {
    try {
      if ((await runEvaluation(row.organization_id, row.evaluation_id)) !== null) ran += 1;
    } catch (error) {
      console.error(`[evaluations] ${row.evaluation_id}`, error);
    }
  }
  return ran;
}

/** A case its person writes: what it is asked, what it must prepare, what it must never say. */
export const writeEvalCase = defineCommand({
  name: 'write-agent-case',
  input: z.object({
    agentId: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(120),
    ask: z.string().trim().min(1).max(2000),
    prepares: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/))
      .max(5)
      .default([]),
    neverSays: z.array(z.string().trim().min(2).max(120)).max(5).default([]),
    by: z.string().min(1).max(128),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const id = newId('evc');
    await db.query(
      `insert into agent_eval_cases (organization_id, case_id, agent_id, name, ask, expect, written_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        organizationId,
        id,
        input.agentId,
        input.name,
        input.ask,
        JSON.stringify({ prepares: input.prepares, neverSays: input.neverSays }),
        input.by,
      ],
    );
    return { caseId: id };
  },
  summarize: (input) => `A case written for ${input.agentId}`,
});

/** Its last evaluations, for its record. */
export async function evaluationsOf(db: SqlExecutor, agentId: string) {
  const { rows } = await db.query<{
    evaluation_id: string;
    because: string;
    status: string;
    score: string | null;
    cases: number | null;
    failures: { name: string; failures: string[] }[];
    asked_at: Date;
  }>(
    `select evaluation_id, because, status, score, cases, failures, asked_at from agent_evaluations
      where agent_id = $1 order by asked_at desc limit 10`,
    [agentId],
  );
  return rows.map((r) => ({
    evaluationId: r.evaluation_id,
    because: r.because,
    status: r.status,
    score: r.score === null ? null : Number(r.score),
    cases: r.cases,
    failures: r.failures,
    askedAt: r.asked_at.toISOString(),
  }));
}
