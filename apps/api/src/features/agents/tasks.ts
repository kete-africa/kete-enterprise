import { ask } from '@kete/ai';
import type { CapabilityTool } from '@kete/capabilities';
import { MAX_DELEGATION_DEPTH, type Actor } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { getPool, transaction } from '../../platform/db.js';
import { organizationLanguageModel } from '../../platform/models.js';
import { sourcesOf, type Source } from '../../platform/sources.js';
import { usageStore } from '../../platform/usage.js';
import { toolPermissions, toolsForAgent } from '../gateway/index.js';
import { notificationWords, tell } from '../notifications/index.js';
import { readModules } from '../organization/index.js';
import type { Agent } from './agents.record.js';
import { findAgent, personOfAgent } from './infrastructure/agents.tables.js';

// Tasks given to agents (spec 036): a person gives one of her agents an instruction; the worker
// runs it in the background — her capabilities narrowed to its job description, every commitment
// a draft she decides — and tells her when it is done. An agent may hand part of it to another of
// her agents: the chain is carried, at most four agents deep, always back to her.

export function agentTasksMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.agent_tasks (
  organization_id text not null,
  task_id text not null,
  agent_id text not null,
  given_by text not null,
  parent_task_id text,
  delegated_by text[] not null default '{}',
  trace_id text not null,
  instruction text not null check (length(instruction) between 1 and 4000),
  status text not null check (status in ('queued', 'running', 'done', 'failed', 'stopped')),
  answer text,
  steps jsonb not null default '[]',
  draft_ids text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  primary key (organization_id, task_id)
);
create index agent_tasks_agent on ${s}.agent_tasks (organization_id, agent_id, created_at desc);
${organizationPolicySql({ schema: s, table: 'agent_tasks', appRole: options.appRole })}
grant select, insert, update on ${s}.agent_tasks to ${options.appRole};

create function ${s}.agent_tasks_queued() returns table (organization_id text, task_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, task_id from agent_tasks where status = 'queued'
        order by created_at limit 20 $$;
revoke all on function ${s}.agent_tasks_queued() from public;
grant execute on function ${s}.agent_tasks_queued() to ${options.appRole};
`;
}

export const giveTaskInput = z.object({ instruction: z.string().trim().min(1).max(4000) });

/** One step of a task, as it was recorded: the tool, the right it used, what it read (spec 056). */
export interface TaskStep {
  tool: string;
  status: string;
  permission?: string;
  /** The tool's autonomy level: 1 reads, 2 acts reversibly, 3 prepares a draft. */
  level?: number;
  sources?: Source[];
}

export interface AgentTask {
  taskId: string;
  agentId: string;
  givenBy: string;
  parentTaskId: string | null;
  delegatedBy: string[];
  instruction: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  answer: string | null;
  steps: TaskStep[];
  draftIds: string[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type TaskRow = {
  task_id: string;
  agent_id: string;
  given_by: string;
  parent_task_id: string | null;
  delegated_by: string[];
  trace_id: string;
  instruction: string;
  status: AgentTask['status'];
  answer: string | null;
  steps: AgentTask['steps'];
  draft_ids: string[];
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};
const taskOf = (r: TaskRow): AgentTask => ({
  taskId: r.task_id,
  agentId: r.agent_id,
  givenBy: r.given_by,
  parentTaskId: r.parent_task_id,
  delegatedBy: r.delegated_by,
  instruction: r.instruction,
  status: r.status,
  answer: r.answer,
  steps: r.steps,
  draftIds: r.draft_ids,
  error: r.error,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
});
const COLUMNS = `task_id, agent_id, given_by, parent_task_id, delegated_by, trace_id, instruction,
  status, answer, steps, draft_ids, error, created_at, started_at, finished_at`;

export async function queueTask(
  db: SqlExecutor,
  input: {
    organizationId: string;
    agentId: string;
    givenBy: string;
    instruction: string;
    parentTaskId?: string;
    delegatedBy?: string[];
    traceId?: string;
  },
): Promise<AgentTask> {
  const { rows } = await db.query<TaskRow>(
    `insert into agent_tasks (organization_id, task_id, agent_id, given_by, parent_task_id,
       delegated_by, trace_id, instruction, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued') returning ${COLUMNS}`,
    [
      input.organizationId,
      newId('tsk'),
      input.agentId,
      input.givenBy,
      input.parentTaskId ?? null,
      input.delegatedBy ?? [],
      input.traceId ?? `trace-${randomUUID()}`,
      input.instruction,
    ],
  );
  return taskOf(rows[0] as TaskRow);
}

export async function getTask(db: SqlExecutor, taskId: string): Promise<AgentTask | null> {
  const { rows } = await db.query<TaskRow>(
    `select ${COLUMNS} from agent_tasks where task_id = $1`,
    [taskId],
  );
  return rows[0] ? taskOf(rows[0]) : null;
}

/** An agent's tasks, the latest first. */
export async function tasksOf(db: SqlExecutor, agentId: string): Promise<AgentTask[]> {
  const { rows } = await db.query<TaskRow>(
    `select ${COLUMNS} from agent_tasks where agent_id = $1 order by created_at desc limit 50`,
    [agentId],
  );
  return rows.map(taskOf);
}

/** What her agents are doing for her now: queued or running, the oldest first (spec 058). */
export async function ongoingFor(
  db: SqlExecutor,
  userId: string,
): Promise<(AgentTask & { agentName: string })[]> {
  const { rows } = await db.query<TaskRow & { agent_name: string }>(
    `select ${COLUMNS.replace(/(\w+)/g, 't.$1')}, a.name as agent_name
       from agent_tasks t join agents a on a.agent_id = t.agent_id
      where t.given_by = $1 and t.status in ('queued', 'running')
      order by t.created_at limit 20`,
    [userId],
  );
  return rows.map((r) => ({ ...taskOf(r), agentName: r.agent_name }));
}

/** What her agents finished for her since a moment: done or failed, newest first (spec 046). */
export async function finishedFor(
  db: SqlExecutor,
  userId: string,
  since: Date,
): Promise<(AgentTask & { agentName: string })[]> {
  const { rows } = await db.query<TaskRow & { agent_name: string }>(
    `select ${COLUMNS.replace(/(\w+)/g, 't.$1')}, a.name as agent_name
       from agent_tasks t join agents a on a.agent_id = t.agent_id
      where t.given_by = $1 and t.status in ('done', 'failed') and t.finished_at >= $2
      order by t.finished_at desc limit 20`,
    [userId, since],
  );
  return rows.map((r) => ({ ...taskOf(r), agentName: r.agent_name }));
}

export async function childrenOf(db: SqlExecutor, taskId: string): Promise<AgentTask[]> {
  const { rows } = await db.query<TaskRow>(
    `select ${COLUMNS} from agent_tasks where parent_task_id = $1 order by created_at`,
    [taskId],
  );
  return rows.map(taskOf);
}

/** A task not yet started is stopped; one running finishes its current step and stops. */
export async function stopTask(db: SqlExecutor, taskId: string): Promise<boolean> {
  const { rows } = await db.query(
    `update agent_tasks set status = 'stopped', finished_at = now()
      where task_id = $1 and status in ('queued', 'running') returning task_id`,
    [taskId],
  );
  return rows.length > 0;
}

async function finish(
  db: SqlExecutor,
  taskId: string,
  outcome: Pick<AgentTask, 'status' | 'answer' | 'steps' | 'draftIds' | 'error'>,
) {
  await db.query(
    `update agent_tasks set status = $2, answer = $3, steps = $4, draft_ids = $5, error = $6,
       finished_at = now() where task_id = $1 and status = 'running'`,
    [
      taskId,
      outcome.status,
      outcome.answer,
      JSON.stringify(outcome.steps),
      outcome.draftIds,
      outcome.error,
    ],
  );
}

let modelOverride: Parameters<typeof ask>[0]['model'] | null | undefined;

/** Tests: run tasks with another model (`null`: as if none were configured). */
export function useTaskModel(next: Parameters<typeof ask>[0]['model'] | null | undefined): void {
  modelOverride = next;
}

const delegateInput = z.object({
  agentId: z.string().min(1).max(80).describe('L’agent à qui confier (parmi agents_available)'),
  instruction: z.string().trim().min(1).max(4000).describe('Ce qu’il doit faire'),
});

/**
 * The tools an agent hands work on with: the other agents of its person, and delegating to one —
 * never back to an agent of its chain, never deeper than four agents.
 */
function delegationTools(
  organizationId: string,
  userId: string,
  task: AgentTask,
  agent: Agent,
): CapabilityTool[] {
  const chain = [...task.delegatedBy, agent.agentId];
  if (chain.length >= MAX_DELEGATION_DEPTH) return [];
  const others = async (db: SqlExecutor) => {
    const { rows } = await db.query<{ agent_id: string; name: string; mission: string }>(
      `select agent_id, name, mission from agents
        where status = 'active' and responsible_user_id = $1 and not (agent_id = any($2))
        order by name`,
      [userId, chain],
    );
    return rows;
  };
  return [
    {
      name: 'agents_available',
      description: 'Les autres agents de la personne, à qui confier une partie du travail.',
      input: z.object({}),
      jsonSchema: {},
      autonomy: 1,
      async execute() {
        const rows = await transaction(organizationId, others);
        return {
          status: 'done',
          output: rows.map((r) => ({ agentId: r.agent_id, name: r.name, mission: r.mission })),
        };
      },
    },
    {
      name: 'delegate_task',
      description:
        'Confie une partie du travail à un autre agent de la personne : il la traitera de son côté, et la personne en verra le résultat.',
      input: delegateInput,
      jsonSchema: z.toJSONSchema(delegateInput) as Record<string, unknown>,
      autonomy: 1,
      async execute(input) {
        const parsed = delegateInput.safeParse(input);
        if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
        return transaction(organizationId, async (db) => {
          if (!(await others(db)).some((r) => r.agent_id === parsed.data.agentId)) {
            return { status: 'refused' as const, reason: 'not_allowed' as const };
          }
          const child = await queueTask(db, {
            organizationId,
            agentId: parsed.data.agentId,
            givenBy: task.givenBy,
            instruction: parsed.data.instruction,
            parentTaskId: task.taskId,
            delegatedBy: chain,
          });
          return { status: 'done' as const, output: { delegated: child.taskId } };
        });
      },
    },
  ];
}

/**
 * Runs one queued task: its agent active and its organization's agents on (the kill switch), its
 * person found, her capabilities narrowed to its job description, every call journaled as the
 * agent's for her. The person is told when it ends.
 */
export async function runTask(
  organizationId: string,
  taskId: string,
): Promise<AgentTask['status']> {
  const prepared = await transaction(organizationId, async (db) => {
    const { rows } = await db.query<TaskRow>(
      `update agent_tasks set status = 'running', started_at = now()
        where task_id = $1 and status = 'queued' returning ${COLUMNS}`,
      [taskId],
    );
    const row = rows[0];
    if (!row) return null;
    const task = taskOf(row);
    const agent = await findAgent(db, task.agentId);
    const on = (await readModules(db)).agents;
    const userId = agent ? await personOfAgent(db, agent) : null;
    return { task, traceId: row.trace_id, agent, on, userId };
  });
  if (!prepared) return 'stopped';
  const { task, agent, on, userId, traceId } = prepared;
  const fail = async (status: 'stopped' | 'failed', error: string) => {
    await transaction(organizationId, (db) =>
      finish(db, taskId, { status, answer: null, steps: [], draftIds: [], error }),
    );
    return status;
  };
  if (!agent || agent.status !== 'active' || !on) return fail('stopped', 'agent_stopped');
  if (!userId) return fail('failed', 'nobody_to_act_for');
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) return fail('failed', 'assistant_unavailable');

  const actor: Actor = {
    kind: 'agent',
    id: agent.agentId,
    channel: 'worker',
    onBehalfOf: { kind: 'person', id: userId },
    // Every gesture of a task carries its trace: « Comment ? » finds them in the journal.
    traceId,
    ...(task.delegatedBy.length
      ? { delegatedBy: task.delegatedBy.map((id) => ({ kind: 'agent' as const, id })) }
      : {}),
  };
  const person = { organizationId, userId };
  // What each tool it holds asks for: its permission, its level (spec 056).
  const facts = new Map<string, { permission: string | undefined; level: number }>();
  try {
    const answer = await asPerson(
      {
        ...person,
        email: '',
        name: '',
        role: null,
        apps: {},
        twoFactor: false,
        expiresAt: new Date(),
      },
      async () => {
        const own = await toolsForAgent(person, actor, {
          permissions: agent.permissions,
          autonomyMax: agent.autonomyMax,
          autonomyByPermission: agent.autonomyByPermission,
          draftBudget: agent.draftBudget,
        });
        const permissionOf = await toolPermissions(organizationId, actor);
        for (const tool of own) {
          facts.set(tool.name, { permission: permissionOf.get(tool.name), level: tool.autonomy });
        }
        const tools = [...own, ...delegationTools(organizationId, userId, task, agent)];
        return ask({
          model,
          system:
            `Tu es ${agent.name}, un agent de Kete Enterprise. Ta mission : ${agent.mission}\n` +
            'Tu agis pour une personne et jamais au-delà de ses droits. Ce qui engage passe par un ' +
            'brouillon qu’elle valide. Réponds en français, brièvement : ce que tu as fait, ce qui ' +
            'attend sa décision, ce que tu n’as pas pu faire.',
          prompt: task.instruction,
          tools,
          maxSteps: 8,
          metering: {
            store: usageStore(),
            context: { organizationId, actor, purpose: 'agents', model: '' },
          },
        });
      },
    );
    const outputs = answer.toolResults.map((r) => ({
      tool: r.name,
      output: r.output as { status?: string; draftId?: string },
    }));
    const steps: TaskStep[] = outputs.map((o) => {
      const fact = facts.get(o.tool);
      const sources = sourcesOf(o.output);
      return {
        tool: o.tool,
        status: o.output?.status ?? 'done',
        ...(fact?.permission ? { permission: fact.permission } : {}),
        ...(fact ? { level: fact.level } : {}),
        ...(sources.length > 0 ? { sources } : {}),
      };
    });
    const draftIds = outputs.flatMap((o) => (o.output?.draftId ? [o.output.draftId] : []));
    await transaction(organizationId, async (db) => {
      await finish(db, taskId, {
        status: 'done',
        answer: answer.text,
        steps,
        draftIds,
        error: null,
      });
      await tell(db, organizationId, userId, {
        kind: 'agent.task',
        title: notificationWords().agentTaskDone(agent.name),
        href: '/mes-agents',
      });
    });
    return 'done';
  } catch (error) {
    return fail('failed', (error as Error).message.slice(0, 500));
  }
}

/** The queued tasks of every organization, run one after the other (the worker, every minute). */
export async function runQueuedTasks(): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string; task_id: string }>(
    `select organization_id, task_id from agent_tasks_queued()`,
  );
  for (const row of rows) await runTask(row.organization_id, row.task_id);
  return rows.length;
}

/** How many tasks failed since a date, across the organization's agents (spec 054). */
export async function failedTasksSince(db: SqlExecutor, since: Date): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from agent_tasks where status = 'failed' and created_at >= $1`,
    [since],
  );
  return Number(rows[0]?.n ?? 0);
}
