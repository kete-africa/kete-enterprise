import { readJournal } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import type { Agent } from './agents.record.js';
import { findAgent } from './infrastructure/agents.tables.js';
import type { AgentTask, TaskStep } from './tasks.js';

// « Comment ? » (spec 056): beside anything an agent did, how it did it — who asked, each step
// with the right it used and how far it was allowed to go, what it read, the gestures the journal
// keeps, what waits for its person, and the rights of its job description. Nothing is rebuilt
// after the fact: only what was recorded when it ran.

export interface How {
  taskId: string;
  instruction: string;
  status: AgentTask['status'];
  agent: { agentId: string; name: string };
  /** Who asked: its person (the reader herself or not), or the agents that handed the work on. */
  askedBy: { kind: 'person'; reader: boolean } | { kind: 'agents'; names: string[] };
  askedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: TaskStep[];
  /** What the journal keeps of it: the commands it ran alone, each undone or not. */
  gestures: { at: string; command: string; summary: string | null; reversible: boolean }[];
  /** What it prepared and left to its person to decide. */
  draftCount: number;
  error: string | null;
  /** Its job description: what it may touch, and how far it may go alone. */
  rights: { permissions: string[]; autonomyMax: number };
}

/** How an agent did a task, from what was recorded: the task, its steps, the journal's lines. */
export async function howOf(
  db: SqlExecutor,
  task: AgentTask,
  agent: Agent,
  readerId: string,
): Promise<How> {
  const { rows } = await db.query<{ trace_id: string }>(
    'select trace_id from agent_tasks where task_id = $1',
    [task.taskId],
  );
  const traceId = rows[0]?.trace_id;
  // A delegated work shares its trace: only this agent's own gestures are its.
  const journal = traceId ? await readJournal(db, { traceId, limit: 200 }) : [];
  const names: string[] = [];
  for (const id of task.delegatedBy) names.push((await findAgent(db, id))?.name ?? id);
  return {
    taskId: task.taskId,
    instruction: task.instruction,
    status: task.status,
    agent: { agentId: agent.agentId, name: agent.name },
    askedBy: names.length
      ? { kind: 'agents', names }
      : { kind: 'person', reader: task.givenBy === readerId },
    askedAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    steps: task.steps,
    gestures: journal
      .filter((line) => line.actor.kind === 'agent' && line.actor.id === task.agentId)
      .map((line) => ({
        at: line.createdAt.toISOString(),
        command: line.name,
        summary: line.summary,
        reversible: line.reversible,
      }))
      .reverse(),
    draftCount: task.draftIds.length,
    error: task.error,
    rights: { permissions: agent.permissions, autonomyMax: agent.autonomyMax },
  };
}
