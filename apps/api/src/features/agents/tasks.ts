import { OUTSIDE_ABILITIES, runAgent } from '@kete/agents';
import { BudgetExceededError } from '@kete/ai';
import type { CapabilityTool, InvocationResult } from '@kete/capabilities';
import { MAX_DELEGATION_DEPTH, type Actor } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { LanguageModel } from 'ai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { organizationLanguageModel, organizationModelConfig } from '../../platform/models.js';
import { sourcesOf, type Source } from '../../platform/sources.js';
import { usageStore } from '../../platform/usage.js';
import { abilitiesIn, abilityTools, computerForRun, researcherOf } from '../ai/index.js';
import { decideDraft, toolPermissions, toolsForAgent, underPolicies } from '../gateway/index.js';
import { notificationWords, tell } from '../notifications/index.js';
import { readModules } from '../organization/index.js';
import { putTask, spaceHref } from '../workspace/index.js';
import type { Agent } from './agents.record.js';
import { findAgent, personOfAgent } from './infrastructure/agents.tables.js';
import { listMemories, memoryPrompt, rememberTool } from '../assistant/memory.js';
import { budgetSpent } from './budget.js';
import { objectContextFor } from './context.js';
import { agentToolSets } from './toolsets.js';

// Tasks given to agents (spec 036): a person gives one of her agents an instruction; the worker
// runs it in the background — her capabilities narrowed to its job description, every commitment
// a draft she decides — and tells her when it is done. An agent may hand part of it to another of
// her agents: the chain is carried, at most four agents deep, always back to her.
//
// She steers it while it works (spec 066): pause it, write to it, take the work over. A running
// task reads what she asked before each of its steps and stops there; what it did is kept.

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

/**
 * Tasks a person steers while they run, and agents private or shared (spec 066, doctrine D-044).
 * No new table: the rows stay under the policies of their tables.
 */
export function agentsAtWorkMigrationSql(options: { schema: string }): string {
  const s = options.schema;
  return `
alter table ${s}.agent_tasks drop constraint agent_tasks_status_check;
alter table ${s}.agent_tasks
  add constraint agent_tasks_status_check check (status in
    ('queued', 'running', 'paused', 'done', 'failed', 'stopped', 'taken_over')),
  add column notes jsonb not null default '[]',
  add column control text check (control in ('pause', 'redirect', 'takeover')),
  add column control_by text,
  add column control_by_name text,
  add column control_at timestamptz;
alter table ${s}.agents
  add column visibility text not null default 'private' check (visibility in ('private', 'shared')),
  add column shared_with text[] not null default '{}';
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
  /** The organization's rule that refused it, in its own sentence (spec 068). */
  rule?: string;
}

/** What she wrote to it while it worked: it comes before its instruction. */
export interface TaskNote {
  text: string;
  by: string;
  at: string;
}

/** What she asked of a running task: it obeys before its next step. */
export type TaskControl = 'pause' | 'redirect' | 'takeover';

/** Who steers a task: her identifier, and her name as the screens show it. */
export interface Steerer {
  userId: string;
  name: string;
}

export interface AgentTask {
  taskId: string;
  agentId: string;
  givenBy: string;
  parentTaskId: string | null;
  delegatedBy: string[];
  instruction: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'taken_over';
  answer: string | null;
  steps: TaskStep[];
  draftIds: string[];
  error: string | null;
  notes: TaskNote[];
  /** Asked of it while it runs, and not yet obeyed. */
  control: TaskControl | null;
  /** Who paused it, stopped it or took it over, and when. */
  steeredBy: { userId: string; name: string; at: string } | null;
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
  notes: TaskNote[];
  control: TaskControl | null;
  control_by: string | null;
  control_by_name: string | null;
  control_at: Date | null;
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
  notes: r.notes,
  control: r.control,
  steeredBy:
    r.control_by && r.control_at
      ? {
          userId: r.control_by,
          name: r.control_by_name ?? r.control_by,
          at: r.control_at.toISOString(),
        }
      : null,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
});
const COLUMNS = `task_id, agent_id, given_by, parent_task_id, delegated_by, trace_id, instruction,
  status, answer, steps, draft_ids, error, notes, control, control_by, control_by_name, control_at,
  created_at, started_at, finished_at`;

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
    /** Set by its routine (spec 099, FR-015): what it asks then expires after ten minutes. */
    fromRoutine?: boolean;
  },
): Promise<AgentTask> {
  const { rows } = await db.query<TaskRow>(
    `insert into agent_tasks (organization_id, task_id, agent_id, given_by, parent_task_id,
       delegated_by, trace_id, instruction, status, from_routine)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9) returning ${COLUMNS}`,
    [
      input.organizationId,
      newId('tsk'),
      input.agentId,
      input.givenBy,
      input.parentTaskId ?? null,
      input.delegatedBy ?? [],
      input.traceId ?? `trace-${randomUUID()}`,
      input.instruction,
      input.fromRoutine === true,
    ],
  );
  return taskOf(rows[0] as TaskRow);
}

/** Its computer's minutes this month: the time of its tasks that used one (spec 099, FR-016). */
async function computerMinutesUsed(db: SqlExecutor, agentId: string): Promise<number> {
  const { rows } = await db.query<{ minutes: string | null }>(
    `select sum(extract(epoch from (coalesce(finished_at, now()) - started_at)) / 60) as minutes
       from agent_tasks
      where agent_id = $1 and started_at >= date_trunc('month', now())
        and steps @> '[{"tool": "computer"}]'`,
    [agentId],
  );
  return Number(rows[0]?.minutes ?? 0);
}

/**
 * « Toujours… » in force (spec 099, FR-015): its person's policy that this agent's drafts of this
 * capability are hers at once. The draft stays, decided by her policy; signing and paying never.
 */
async function alwaysFor(db: SqlExecutor, agentId: string, capability: string): Promise<boolean> {
  if (/sign|pay|purchase/i.test(capability)) return false;
  const { rows } = await db.query<{ status: string }>(
    `select status from kete_policies where policy_id = $1 order by version desc limit 1`,
    [`agent.${agentId}.${capability.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`],
  );
  return rows[0]?.status === 'active';
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

/** What she asked of colleagues' shared agents, the latest first (spec 066). */
export async function givenToShared(
  db: SqlExecutor,
  userId: string,
): Promise<(AgentTask & { agentName: string })[]> {
  const { rows } = await db.query<TaskRow & { agent_name: string }>(
    `select ${COLUMNS.replace(/(\w+)/g, 't.$1')}, a.name as agent_name
       from agent_tasks t join agents a on a.agent_id = t.agent_id
      where t.given_by = $1 and t.parent_task_id is null and a.visibility = 'shared'
        and a.responsible_user_id is distinct from $1
      order by t.created_at desc limit 10`,
    [userId],
  );
  return rows.map((r) => ({ ...taskOf(r), agentName: r.agent_name }));
}

/** What her agents are doing for her now: queued or running, the oldest first (spec 058). */
export async function ongoingFor(
  db: SqlExecutor,
  userId: string,
): Promise<(AgentTask & { agentName: string })[]> {
  const { rows } = await db.query<TaskRow & { agent_name: string }>(
    `select ${COLUMNS.replace(/(\w+)/g, 't.$1')}, a.name as agent_name
       from agent_tasks t join agents a on a.agent_id = t.agent_id
      where t.given_by = $1 and t.status in ('queued', 'running', 'paused')
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
export async function stopTask(db: SqlExecutor, taskId: string, by?: Steerer): Promise<boolean> {
  const { rows } = await db.query(
    `update agent_tasks set status = 'stopped', finished_at = now(), control = null,
       control_by = $2, control_by_name = $3, control_at = now()
      where task_id = $1 and status in ('queued', 'running', 'paused') returning task_id`,
    [taskId, by?.userId ?? null, by?.name ?? null],
  );
  return rows.length > 0;
}

/** Paused: a task not yet started waits; one running finishes its current step and waits. */
export async function pauseTask(db: SqlExecutor, taskId: string, by: Steerer): Promise<boolean> {
  const { rows } = await db.query(
    `update agent_tasks
        set status = case status when 'queued' then 'paused' else status end,
            control = case status when 'running' then 'pause' else null end,
            control_by = $2, control_by_name = $3, control_at = now()
      where task_id = $1 and status in ('queued', 'running') returning task_id`,
    [taskId, by.userId, by.name],
  );
  return rows.length > 0;
}

/** A paused task goes on from where it stopped. */
export async function resumeTask(db: SqlExecutor, taskId: string): Promise<boolean> {
  const { rows } = await db.query(
    `update agent_tasks
        set status = 'queued', control = null, control_by = null, control_by_name = null,
            control_at = null
      where task_id = $1 and status = 'paused' returning task_id`,
    [taskId],
  );
  return rows.length > 0;
}

/**
 * She writes to it while it works: her words come before its instruction. A running task stops at
 * its next step and starts again with them; a paused one goes on with them.
 */
export async function writeToTask(
  db: SqlExecutor,
  taskId: string,
  by: Steerer,
  text: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `update agent_tasks
        set notes = notes || jsonb_build_array(
              jsonb_build_object('text', $4::text, 'by', $2::text, 'at', now())),
            status = case status when 'paused' then 'queued' else status end,
            control = case status when 'running' then 'redirect' else null end,
            control_by = case status when 'running' then $2 else null end,
            control_by_name = case status when 'running' then $3 else null end,
            control_at = case status when 'running' then now() else null end
      where task_id = $1 and status in ('queued', 'running', 'paused') returning task_id`,
    [taskId, by.userId, by.name, text],
  );
  return rows.length > 0;
}

/** The work she took over, in her « À faire »: what the agent was doing, and what it had done. */
async function handBack(db: SqlExecutor, organizationId: string, taskId: string): Promise<void> {
  const { rows } = await db.query<{ instruction: string; control_by: string; name: string }>(
    `select t.instruction, t.control_by, a.name
       from agent_tasks t join agents a on a.agent_id = t.agent_id
      where t.task_id = $1 and t.control_by is not null`,
    [taskId],
  );
  const row = rows[0];
  if (!row) return;
  await putTask(db, organizationId, row.control_by, {
    source: 'agents',
    key: taskId,
    title: notificationWords().agentTaskTakenOver(row.name, row.instruction).slice(0, 300),
    href: spaceHref(env.publicWebUrl, `/mes-agents?tache=${taskId}`),
  });
}

/**
 * She takes the work over: the agent stops — at once when it had not started, at its next step
 * when it runs — and the work is hers, in her « À faire », with what it had done.
 */
export async function takeOverTask(
  db: SqlExecutor,
  organizationId: string,
  taskId: string,
  by: Steerer,
): Promise<boolean> {
  const { rows } = await db.query<{ status: AgentTask['status'] }>(
    `update agent_tasks
        set status = case status when 'running' then status else 'taken_over' end,
            control = case status when 'running' then 'takeover' else null end,
            finished_at = case status when 'running' then finished_at else now() end,
            control_by = $2, control_by_name = $3, control_at = now()
      where task_id = $1 and status in ('queued', 'running', 'paused') returning status`,
    [taskId, by.userId, by.name],
  );
  if (rows[0]?.status === 'taken_over') await handBack(db, organizationId, taskId);
  return rows.length > 0;
}

async function finish(
  db: SqlExecutor,
  taskId: string,
  outcome: Pick<AgentTask, 'status' | 'answer' | 'error'>,
) {
  // Its steps and its drafts were written as they happened: an interrupted task keeps them.
  await db.query(
    `update agent_tasks set status = $2, answer = $3, error = $4, finished_at = now()
      where task_id = $1 and status = 'running'`,
    [taskId, outcome.status, outcome.answer, outcome.error],
  );
}

/**
 * What a running task was asked meanwhile, obeyed: paused, queued again with her words, or handed
 * back to her. Nothing when it may go on; its status when it was stopped under it.
 */
async function park(organizationId: string, taskId: string): Promise<AgentTask['status'] | null> {
  return transaction(organizationId, async (db) => {
    const { rows } = await db.query<{ status: AgentTask['status']; control: TaskControl | null }>(
      'select status, control from agent_tasks where task_id = $1 for update',
      [taskId],
    );
    const row = rows[0];
    if (!row) return 'stopped';
    if (row.status !== 'running') return row.status;
    if (row.control === 'pause') {
      await db.query(
        `update agent_tasks set status = 'paused', control = null where task_id = $1`,
        [taskId],
      );
      return 'paused';
    }
    if (row.control === 'redirect') {
      await db.query(
        `update agent_tasks
            set status = 'queued', control = null, control_by = null, control_by_name = null,
                control_at = null
          where task_id = $1`,
        [taskId],
      );
      return 'queued';
    }
    if (row.control === 'takeover') {
      await db.query(
        `update agent_tasks set status = 'taken_over', control = null, finished_at = now()
          where task_id = $1`,
        [taskId],
      );
      await handBack(db, organizationId, taskId);
      return 'taken_over';
    }
    return null;
  });
}

/** The six states of an agent, the same on every screen (spec 066). */
export interface AgentState {
  kind: 'idle' | 'working' | 'waiting' | 'blocked' | 'paused' | 'stopped';
  /** The task that puts it in this state. */
  taskId?: string;
  instruction?: string;
  /** Working: the last step it took, and how many. Blocked: what it lacks. */
  step?: string;
  steps?: number;
  reason?: string;
  /** Waiting: the drafts that wait for its person. */
  drafts?: number;
  /** Since when; idle: its next round. */
  since?: string;
  by?: string;
}

/**
 * Where an agent stands: stopped with its organization's agents, paused by its person, at work,
 * waiting for her decision, blocked on what its last task lacked — or idle until its next round.
 */
export async function stateOfAgent(
  db: SqlExecutor,
  agent: Agent,
  agentsOn: boolean,
): Promise<AgentState> {
  if (!agentsOn) return { kind: 'stopped', reason: 'organization' };
  if (agent.status === 'paused') return { kind: 'paused' };
  const live = await db.query<TaskRow>(
    `select ${COLUMNS} from agent_tasks
      where agent_id = $1 and status in ('running', 'paused', 'queued')
      order by case status when 'running' then 0 when 'paused' then 1 else 2 end, created_at
      limit 1`,
    [agent.agentId],
  );
  const task = live.rows[0] ? taskOf(live.rows[0]) : null;
  if (task?.status === 'paused') {
    return {
      kind: 'paused',
      taskId: task.taskId,
      instruction: task.instruction,
      ...(task.steeredBy ? { by: task.steeredBy.name, since: task.steeredBy.at } : {}),
    };
  }
  if (task) {
    const last = task.steps.at(-1);
    return {
      kind: 'working',
      taskId: task.taskId,
      instruction: task.instruction,
      steps: task.steps.length,
      since: task.startedAt ?? task.createdAt,
      ...(last ? { step: last.tool } : {}),
    };
  }
  const waiting = await db.query<{ n: string }>(
    `select count(*) as n from kete_drafts where prepared_by_id = $1 and status = 'prepared'`,
    [agent.agentId],
  );
  const drafts = Number(waiting.rows[0]?.n ?? 0);
  if (drafts > 0) return { kind: 'waiting', drafts };
  const latest = await db.query<TaskRow>(
    `select ${COLUMNS} from agent_tasks where agent_id = $1 order by created_at desc limit 1`,
    [agent.agentId],
  );
  const before = latest.rows[0] ? taskOf(latest.rows[0]) : null;
  if (before?.status === 'failed') {
    return {
      kind: 'blocked',
      taskId: before.taskId,
      instruction: before.instruction,
      reason: before.error ?? 'failed',
      ...(before.finishedAt ? { since: before.finishedAt } : {}),
    };
  }
  return { kind: 'idle', since: agent.nextWakeAt };
}

let modelOverride: LanguageModel | null | undefined;

/** Tests: run tasks with another model (`null`: as if none were configured). */
export function useTaskModel(next: LanguageModel | null | undefined): void {
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

/** What the agent is told to do: her instruction, what it already did, what she wrote since. */
/** The person an agent acts for, as Kete's features read an identity: her rights, no role. */
const identityOf = (person: { organizationId: string; userId: string }) => ({
  ...person,
  email: '',
  name: '',
  role: null,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 60 * 60_000),
});

/** Whether a task's thread is read by more than its one person: no memory there. */
async function sharedThread(db: SqlExecutor, taskId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from agent_task_threads x
       join kete_thread_members m on m.thread_id = x.thread_id
      where x.task_id = $1 and m.member_kind = 'person' and m.until is null`,
    [taskId],
  );
  return (rows[0]?.n ?? 0) > 1;
}

function promptOf(task: AgentTask): string {
  return [
    task.instruction,
    task.steps.length > 0
      ? `Déjà fait avant l’interruption : ${task.steps.map((step) => step.tool).join(', ')}. ` +
        'Ne le refais pas sans raison.'
      : '',
    task.notes.length > 0
      ? 'Ce que la personne vous a écrit en cours de route — cela passe avant la consigne :\n' +
        task.notes.map((note) => `- ${note.text}`).join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Runs one queued task: its agent active and its organization's agents on (the kill switch), its
 * person found, her capabilities narrowed to its job description, every call journaled as the
 * agent's for her. Before each step it reads what she asked meanwhile — pause, new words, the work
 * taken over — and stops there. The person is told when it ends.
 *
 * A shared agent called by a colleague acts with the colleague's rights, narrowed to what the
 * agent may do — never with its owner's (doctrine D-044).
 */
export async function runTask(
  organizationId: string,
  taskId: string,
): Promise<AgentTask['status']> {
  const prepared = await transaction(organizationId, async (db) => {
    const { rows } = await db.query<TaskRow>(
      `update agent_tasks
          set status = 'running', started_at = coalesce(started_at, now()), control = null,
              control_by = null, control_by_name = null, control_at = null
        where task_id = $1 and status = 'queued' returning ${COLUMNS}`,
      [taskId],
    );
    const row = rows[0];
    if (!row) return null;
    const task = taskOf(row);
    const agent = await findAgent(db, task.agentId);
    const on = (await readModules(db)).agents;
    const owner = agent ? await personOfAgent(db, agent) : null;
    const called =
      agent?.visibility === 'shared' && task.delegatedBy.length === 0 && task.givenBy !== owner;
    return { task, traceId: row.trace_id, agent, on, userId: called ? task.givenBy : owner };
  });
  if (!prepared) return 'stopped';
  const { task, agent, on, userId, traceId } = prepared;
  const fail = async (status: 'stopped' | 'failed', error: string) => {
    await transaction(organizationId, (db) => finish(db, taskId, { status, answer: null, error }));
    await answered(organizationId, taskId);
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
  const abort = new AbortController();
  // What she asked while it worked: read before each step, obeyed there.
  const interrupted = async () => {
    const { rows } = await transaction(organizationId, (db) =>
      db.query<{ status: string; control: string | null }>(
        'select status, control from agent_tasks where task_id = $1',
        [taskId],
      ),
    );
    return rows[0]?.status !== 'running' || rows[0].control !== null;
  };
  // Each step is written as it happens: the run is seen live, and an interrupted task keeps it.
  const record = async (name: string, result: InvocationResult) => {
    const fact = facts.get(name);
    const sources = sourcesOf(result);
    const rule = (result as { rule?: { sentence?: unknown } }).rule?.sentence;
    const step: TaskStep = {
      tool: name,
      status: result.status,
      ...(fact?.permission ? { permission: fact.permission } : {}),
      ...(fact ? { level: fact.level } : {}),
      ...(sources.length > 0 ? { sources } : {}),
      ...(typeof rule === 'string' ? { rule } : {}),
    };
    await transaction(organizationId, (db) =>
      db.query(
        `update agent_tasks set steps = steps || $2::jsonb, draft_ids = draft_ids || $3::text[]
          where task_id = $1`,
        [taskId, JSON.stringify([step]), result.status === 'draft' ? [result.draftId] : []],
      ),
    );
  };
  // A computer of the task's own, when it asks for one: deleted at its end.
  const computer = computerForRun();
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
        // On trial (born from one sentence), it only proposes: never above « prepare ».
        const onTrial = agent.trialUntil !== null && Date.parse(agent.trialUntil) > Date.now();
        const own = await toolsForAgent(person, actor, {
          permissions: agent.permissions,
          autonomyMax: onTrial ? Math.min(agent.autonomyMax, 2) : agent.autonomyMax,
          autonomyByPermission: onTrial
            ? Object.fromEntries(
                Object.entries(agent.autonomyByPermission).map(([p, l]) => [p, Math.min(l, 2)]),
              )
            : agent.autonomyByPermission,
          draftBudget: agent.draftBudget,
        });
        const permissionOf = await toolPermissions(organizationId, actor);
        for (const tool of own) {
          facts.set(tool.name, { permission: permissionOf.get(tool.name), level: tool.autonomy });
        }
        // What the organization lets its agents do beyond Kete (spec 094): the web, a computer of
        // the task's own, deleted when it ends — under its policies like every tool.
        const metering = {
          store: usageStore(),
          context: { organizationId, actor, purpose: 'agents', model: '' },
        };
        // Its own computer only when its job description gives it one, within its minutes.
        const abilities = await transaction(organizationId, async (db) => {
          const on = await abilitiesIn(db, organizationId);
          const minutes = agent.computerMinutes;
          const left = minutes !== null && (await computerMinutesUsed(db, agent.agentId)) < minutes;
          return on.filter((ability) => ability !== 'computer' || left);
        }).catch(() => []);
        const beyond = underPolicies(
          organizationId,
          actor,
          abilityTools({ abilities, config: organizationModelConfig(), metering, computer }),
        );
        const researcher = researcherOf(beyond);
        // Kete's own sets its job description names (spec 104): the library, a team's tables, forms,
        // documents, dashboards — each reading with her rights, never above its level.
        const keteOwn = await agentToolSets(identityOf(person), {
          sources: agent.sources,
          autonomyMax: onTrial ? Math.min(agent.autonomyMax, 2) : agent.autonomyMax,
        });
        for (const tool of keteOwn)
          facts.set(tool.name, { permission: undefined, level: tool.autonomy });
        // What it works on, when the task is about an object: its card, links, last words.
        const context = await transaction(organizationId, (db) =>
          objectContextFor(db, identityOf(person), taskId),
        ).catch(() => '');
        // What she asked to be remembered — never in a thread several people read (spec 106).
        const remembered = await transaction(organizationId, async (db) =>
          (await sharedThread(db, taskId)) ? [] : listMemories(db, userId),
        ).catch(() => []);
        const tools = [
          ...(agent.sources.includes('kete') ? own : []),
          ...keteOwn,
          rememberTool(person, agent.agentId),
          ...beyond,
          ...delegationTools(organizationId, userId, task, agent),
        ].map((tool): CapabilityTool => ({
          ...tool,
          async execute(input) {
            if (await interrupted()) {
              abort.abort();
              return { status: 'confirmation_required', message: 'Interrupted by its person.' };
            }
            const result = await tool.execute(input);
            await record(tool.name, result);
            // « Toujours… » in force: her policy decides this draft for her, at once.
            if (
              result.status === 'draft' &&
              (await transaction(organizationId, (db) =>
                alwaysFor(db, agent.agentId, tool.name),
              ).catch(() => false))
            ) {
              await decideDraft(person, result.draftId, { action: 'validate' }).catch(
                () => undefined,
              );
            }
            return result;
          },
        }));
        return runAgent({
          agent: agent.agentId,
          name: agent.name,
          model,
          instructions:
            `Tu es ${agent.name}, un agent de Kete Enterprise. Ta mission : ${agent.mission}\n` +
            'Tu agis pour une personne et jamais au-delà de ses droits. Ce qui engage passe par un ' +
            'brouillon qu’elle valide. Réponds en français, brièvement : ce que tu as fait, ce qui ' +
            'attend sa décision, ce que tu n’as pas pu faire.',
          messages: [
            {
              role: 'user',
              content: [context, memoryPrompt(remembered), promptOf(task)]
                .filter(Boolean)
                .join('\n\n'),
            },
          ],
          tools,
          maxSteps: 8,
          metering,
          // What a page or a computer said is outside content: nothing acts at once after it.
          outside: { tools: OUTSIDE_ABILITIES },
          ...(researcher ? { subAgents: [researcher] } : {}),
          abortSignal: abort.signal,
        });
      },
    );
    const parked = await park(organizationId, taskId);
    if (parked) return parked;
    await transaction(organizationId, async (db) => {
      await finish(db, taskId, { status: 'done', answer: answer.text, error: null });
      await tell(db, organizationId, userId, {
        kind: 'agent.task',
        title: notificationWords().agentTaskDone(agent.name),
        href: '/mes-agents',
      });
    });
    await answered(organizationId, taskId);
    return 'done';
  } catch (error) {
    // Its budget spent: it waits, and its person holds « demander plus » (spec 106, R18).
    if (error instanceof BudgetExceededError) {
      await transaction(organizationId, (db) =>
        budgetSpent(db, organizationId, agent, userId, notificationWords().agentBudgetSpent),
      ).catch(() => undefined);
      return fail('stopped', 'budget_spent');
    }
    // Stopping it at a step may end the run with an error: what she asked comes first.
    const parked = await park(organizationId, taskId).catch(() => null);
    if (parked) return parked;
    return fail('failed', (error as Error).message.slice(0, 500));
  } finally {
    await computer.close();
  }
}

/** Its answer goes to its thread (spec 099, FR-013): what it did, its steps, what it asks. */
async function answered(organizationId: string, taskId: string): Promise<void> {
  const { agentAnswered } = await import('../messages/index.js');
  await agentAnswered(organizationId, taskId).catch((error: unknown) =>
    console.error('[agent thread]', (error as Error).message),
  );
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
