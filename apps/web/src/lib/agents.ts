import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Chart } from './structure';

// The agents as the API serves them (spec 007).

export interface AgentSignal {
  signalId: string;
  kind: string;
  subject: string;
  raisedAt: string;
}

export interface AgentView {
  agentId: string;
  name: string;
  kind: 'personal' | 'position' | 'system';
  mission: string;
  actsFor: string | null;
  positionId: string | null;
  scopeUnitId: string | null;
  permissions: string[];
  autonomyMax: number;
  /** Its level per permission (spec 052). */
  autonomyByPermission: Record<string, number>;
  draftBudget: number;
  wakeEveryMinutes: number;
  watches: string[];
  status: 'active' | 'paused';
  /** Private, or shared with colleagues — everyone, or the units named (spec 066). */
  visibility: 'private' | 'shared';
  sharedWith: string[];
  /** Where it stands: one of six states, the same on every screen (spec 066). */
  state: AgentState;
  nextWakeAt: string;
  lastRunAt: string | null;
  signals: AgentSignal[];
  /** Its latest tasks (spec 036). */
  tasks?: AgentTask[];
}

/** The six states of an agent (spec 066). */
export interface AgentState {
  kind: 'idle' | 'working' | 'waiting' | 'blocked' | 'paused' | 'stopped';
  taskId?: string;
  instruction?: string;
  step?: string;
  steps?: number;
  reason?: string;
  drafts?: number;
  since?: string;
  by?: string;
}

/** An agent a colleague shares with her: what it is for, never how it is set (D-044). */
export interface SharedAgent {
  agentId: string;
  name: string;
  mission: string;
}

export interface AgentsScreen {
  agents: AgentView[];
  /** The agents colleagues share with her, and what she asked of them. */
  shared: SharedAgent[];
  given: (AgentTask & { agentName: string })[];
  watches: string[];
  manages: boolean;
  permissions: string[];
  me: string;
  chart: Chart;
}

/** A task given to an agent (spec 036), as the screens show it. */
export interface AgentTask {
  taskId: string;
  agentId: string;
  parentTaskId: string | null;
  instruction: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'taken_over';
  answer: string | null;
  draftIds: string[];
  createdAt: string;
  /** The steps it took, written as they happen (spec 066). */
  steps: { tool: string; status: string }[];
  /** What she wrote to it while it worked. */
  notes: { text: string; at: string }[];
  /** Asked of it while it runs, and not yet obeyed. */
  control: 'pause' | 'redirect' | 'takeover' | null;
  steeredBy: { name: string; at: string } | null;
}

const taskOf = (t: AgentTask): AgentTask => ({
  taskId: t.taskId,
  agentId: t.agentId,
  parentTaskId: t.parentTaskId,
  instruction: t.instruction,
  status: t.status,
  answer: t.answer,
  draftIds: t.draftIds,
  createdAt: t.createdAt,
  steps: (t.steps ?? []).map((s) => ({ tool: s.tool, status: s.status })),
  notes: (t.notes ?? []).map((n) => ({ text: n.text, at: n.at })),
  control: t.control ?? null,
  steeredBy: t.steeredBy ? { name: t.steeredBy.name, at: t.steeredBy.at } : null,
});

export const fetchAgents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AgentsScreen> => {
    const request = getRequest();
    const [screen, permissions, me, chart, given] = await Promise.all([
      callApi<{
        agents: AgentView[];
        shared?: SharedAgent[];
        watches: string[];
        manages: boolean;
      }>(request, '/v1/agents'),
      callApi<{ permissions: string[] }>(request, '/v1/rights/permissions'),
      callApi<{ userId: string }>(request, '/v1/me'),
      callApi<Chart>(request, '/v1/structure'),
      callApi<{ tasks: (AgentTask & { agentName: string })[] }>(request, '/v1/agents/tasks/given')
        .then((r) => r.tasks)
        .catch(() => []),
    ]);
    const agents = screen.agents.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      kind: a.kind,
      mission: a.mission,
      actsFor: a.actsFor,
      positionId: a.positionId,
      scopeUnitId: a.scopeUnitId,
      permissions: a.permissions,
      autonomyMax: a.autonomyMax,
      autonomyByPermission: a.autonomyByPermission ?? {},
      draftBudget: a.draftBudget,
      wakeEveryMinutes: a.wakeEveryMinutes,
      watches: a.watches,
      status: a.status,
      visibility: a.visibility ?? 'private',
      sharedWith: a.sharedWith ?? [],
      state: a.state ?? { kind: 'idle' as const },
      nextWakeAt: a.nextWakeAt,
      lastRunAt: a.lastRunAt,
      signals: a.signals.map((s) => ({
        signalId: s.signalId,
        kind: s.kind,
        subject: s.subject,
        raisedAt: s.raisedAt,
      })),
    }));
    // Each agent's latest tasks (spec 036).
    const tasks = await Promise.all(
      agents.map((a) =>
        callApi<{ tasks: AgentTask[] }>(request, `/v1/agents/${a.agentId}/tasks`)
          .then((r) => r.tasks.slice(0, 5).map(taskOf))
          .catch(() => [] as AgentTask[]),
      ),
    );
    return {
      agents: agents.map((a, i) => ({ ...a, tasks: tasks[i] ?? [] })),
      shared: (screen.shared ?? []).map((a) => ({
        agentId: a.agentId,
        name: a.name,
        mission: a.mission,
      })),
      given: given.map((t) => ({ ...taskOf(t), agentName: t.agentName })),
      watches: screen.watches,
      manages: screen.manages,
      permissions: permissions.permissions,
      me: me.userId,
      chart,
    };
  },
);

const paths =
  /^\/(|agt_[0-9a-f-]+\/(status|wake|tasks|autonomy|sharing)|signals\/sig_[0-9a-f-]+\/close|tasks\/tsk_[0-9a-f-]+\/(stop|pause|resume|write|take-over))$/;

export const changeAgents = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.test(path)) throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const target = data.path === '/' ? '/v1/agents' : `/v1/agents${data.path}`;
    const answer = await sendGesture(getRequest(), target, data.body, data.key);
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

/** What an agent did these last days (spec 052). */
export interface AgentRecord {
  since: string;
  tasks: { done: number; failed: number; stopped: number; open: number };
  drafts: { validated: number; refused: number; open: number };
  signals: { raised: number; closed: number };
}

export const fetchAgentRecord = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const id = (input as { agentId?: unknown } | null)?.agentId;
    if (typeof id !== 'string' || !/^agt_[0-9a-f-]+$/.test(id)) throw new Error('Which agent?');
    return { agentId: id };
  })
  .handler(({ data }) =>
    callApi<{ record: AgentRecord }>(getRequest(), `/v1/agents/${data.agentId}/record`),
  );

/** A personal agent's job description from her sentence, and its plan (spec 052). */
export interface AgentProposal {
  name: string;
  mission: string;
  watches: string[];
  permissions: string[];
  autonomyMax: number;
  wakeEveryMinutes: number;
  plan: string[];
}

export const understandAgent = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const sentence = (input as { sentence?: unknown } | null)?.sentence;
    return { sentence: typeof sentence === 'string' ? sentence.trim().slice(0, 1000) : '' };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ proposal: AgentProposal }>(
      getRequest(),
      '/v1/agents/understand',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, proposal: answer.data.proposal, error: null }
      : { ok: false as const, proposal: null, error: answer.error };
  });
