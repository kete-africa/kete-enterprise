import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Requests to colleagues (spec 065, doctrine D-044): work asked of a person, its states and its
// thread, what comes back signed.

export type RequestStatus =
  'received' | 'taken' | 'waiting' | 'returned' | 'declined' | 'cancelled';

export interface ColleagueRequest {
  requestId: string;
  from: { userId: string; name: string };
  to: { userId: string; name: string };
  title: string;
  detail: string;
  dueOn: string | null;
  status: RequestStatus;
  agent: {
    agentId: string;
    name: string;
    work: 'queued' | 'running' | 'done' | 'failed' | 'stopped' | null;
  } | null;
  returned: { text: string; signedBy: string; signedAt: string; preparedBy: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestEvent {
  kind:
    | 'asked'
    | 'taken'
    | 'handed'
    | 'waiting'
    | 'answered'
    | 'note'
    | 'returned'
    | 'declined'
    | 'cancelled'
    | 'reminded'
    | 'agent_done';
  actor: { kind: 'person' | 'agent'; id: string; name: string };
  text: string;
  at: string;
}

export const fetchRequests = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ sent: ColleagueRequest[]; received: ColleagueRequest[] }>(getRequest(), '/v1/requests'),
);

export const fetchRequest = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const id = (input as { requestId?: unknown } | null)?.requestId;
    if (typeof id !== 'string' || !/^rqt_[0-9a-f-]{8,64}$/.test(id)) throw new Error('Unknown.');
    return { requestId: id };
  })
  .handler(({ data }) =>
    callApi<{ request: ColleagueRequest & { events: RequestEvent[] } }>(
      getRequest(),
      `/v1/requests/${data.requestId}`,
    )
      .then((answer) => answer.request)
      .catch(() => null),
  );

export const askColleague = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const text = (value: unknown, max: number) =>
      typeof value === 'string' ? value.trim().slice(0, max) : '';
    const dueOn = text(v.dueOn, 10);
    return {
      colleague: text(v.colleague, 128),
      title: text(v.title, 200),
      detail: text(v.detail, 4000),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? { dueOn } : {}),
    };
  })
  .handler(({ data }) =>
    sendGesture<{ request: ColleagueRequest }>(
      getRequest(),
      '/v1/requests',
      data,
      crypto.randomUUID(),
    ),
  );

export type Move =
  | { kind: 'take' }
  | { kind: 'hand'; agentId: string }
  | { kind: 'wait'; question: string }
  | { kind: 'answer'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'return'; text: string }
  | { kind: 'decline'; reason: string }
  | { kind: 'cancel' }
  | { kind: 'remind' };

export const moveRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { requestId?: unknown; move?: unknown };
    if (typeof v.requestId !== 'string' || !/^rqt_[0-9a-f-]{8,64}$/.test(v.requestId)) {
      throw new Error('Unknown.');
    }
    return { requestId: v.requestId, move: v.move as Move };
  })
  .handler(({ data }) =>
    sendGesture<{ request: ColleagueRequest }>(
      getRequest(),
      `/v1/requests/${data.requestId}/moves`,
      data.move,
      crypto.randomUUID(),
    ),
  );

/** Her own agents, to hand a request to: never another's (D-044). */
export const fetchOwnAgents = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest();
  const [screen, me] = await Promise.all([
    callApi<{
      agents: { agentId: string; name: string; actsFor: string | null; status?: string }[];
    }>(request, '/v1/agents').catch(() => ({ agents: [] })),
    callApi<{ userId: string }>(request, '/v1/me'),
  ]);
  return screen.agents
    .filter((agent) => agent.actsFor === me.userId && (agent.status ?? 'active') === 'active')
    .map((agent) => ({ agentId: agent.agentId, name: agent.name }));
});
