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
  draftBudget: number;
  wakeEveryMinutes: number;
  watches: string[];
  status: 'active' | 'paused';
  nextWakeAt: string;
  lastRunAt: string | null;
  signals: AgentSignal[];
  /** Its latest tasks (spec 036). */
  tasks?: AgentTask[];
}

export interface AgentsScreen {
  agents: AgentView[];
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
  status: 'queued' | 'running' | 'done' | 'failed' | 'stopped';
  answer: string | null;
  draftIds: string[];
  createdAt: string;
}

export const fetchAgents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AgentsScreen> => {
    const request = getRequest();
    const [screen, permissions, me, chart] = await Promise.all([
      callApi<{ agents: AgentView[]; watches: string[]; manages: boolean }>(request, '/v1/agents'),
      callApi<{ permissions: string[] }>(request, '/v1/rights/permissions'),
      callApi<{ userId: string }>(request, '/v1/me'),
      callApi<Chart>(request, '/v1/structure'),
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
      draftBudget: a.draftBudget,
      wakeEveryMinutes: a.wakeEveryMinutes,
      watches: a.watches,
      status: a.status,
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
          .then((r) =>
            r.tasks.slice(0, 5).map((t) => ({
              taskId: t.taskId,
              agentId: t.agentId,
              parentTaskId: t.parentTaskId,
              instruction: t.instruction,
              status: t.status,
              answer: t.answer,
              draftIds: t.draftIds,
              createdAt: t.createdAt,
            })),
          )
          .catch(() => [] as AgentTask[]),
      ),
    );
    return {
      agents: agents.map((a, i) => ({ ...a, tasks: tasks[i] ?? [] })),
      watches: screen.watches,
      manages: screen.manages,
      permissions: permissions.permissions,
      me: me.userId,
      chart,
    };
  },
);

const paths =
  /^\/(|agt_[0-9a-f-]+\/(status|wake|tasks)|signals\/sig_[0-9a-f-]+\/close|tasks\/tsk_[0-9a-f-]+\/stop)$/;

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
