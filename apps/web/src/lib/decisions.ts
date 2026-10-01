import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Role } from './rights';
import type { Chart } from './structure';

// The decisions as the API serves them (spec 005).

export type Rule =
  | { rule: 'manager' }
  | { rule: 'role'; roleId: string }
  | { rule: 'position'; positionId: string }
  | { rule: 'person'; personId: string };

export interface InboxRequest {
  requestId: string;
  subject: string;
  title: string;
  status: 'pending' | 'approved' | 'refused';
  createdAt: string;
  currentStep: number | null;
  overdue: boolean;
  steps: { position: number; rule: Rule; status: string; minMeasure: number | null }[];
}

export interface Circuit {
  circuitId: string;
  subject: string;
  name: string;
  remindAfterHours: number;
  steps: { position: number; rule: Rule; minMeasure: number | null }[];
}

export interface InboxScreen {
  toDecide: InboxRequest[];
  mine: InboxRequest[];
  /** Null when the person may not manage circuits. */
  circuits: { subjects: string[]; circuits: Circuit[]; roles: Role[]; chart: Chart } | null;
}

const plain = (r: InboxRequest): InboxRequest => ({
  requestId: r.requestId,
  subject: r.subject,
  title: r.title,
  status: r.status,
  createdAt: r.createdAt,
  currentStep: r.currentStep,
  overdue: r.overdue,
  steps: r.steps.map((s) => ({
    position: s.position,
    rule: s.rule,
    status: s.status,
    minMeasure: s.minMeasure,
  })),
});

export const fetchInbox = createServerFn({ method: 'GET' }).handler(
  async (): Promise<InboxScreen> => {
    const request = getRequest();
    const [inbox, reaches] = await Promise.all([
      callApi<{ toDecide: InboxRequest[]; mine: InboxRequest[] }>(request, '/v1/decisions/inbox'),
      callApi<{ reaches: { permission: string; everywhere: boolean }[] }>(request, '/v1/rights/me'),
    ]);
    const manages = reaches.reaches.some(
      (r) => r.permission === 'decisions:manage' && r.everywhere,
    );
    const canSeeRoles = reaches.reaches.some(
      (r) => r.permission === 'rights:manage' && r.everywhere,
    );
    let circuits: InboxScreen['circuits'] = null;
    if (manages) {
      const [definitions, chart, rights] = await Promise.all([
        callApi<{ subjects: string[]; circuits: Circuit[] }>(request, '/v1/decisions/circuits'),
        callApi<Chart>(request, '/v1/structure'),
        canSeeRoles
          ? callApi<{ roles: Role[] }>(request, '/v1/rights')
          : Promise.resolve({ roles: [] as Role[] }),
      ]);
      circuits = { ...definitions, roles: rights.roles, chart };
    }
    return { toDecide: inbox.toDecide.map(plain), mine: inbox.mine.map(plain), circuits };
  },
);

const paths = /^\/(circuits|requests\/drq_[0-9a-f-]+\/decide)$/;

export const changeDecisions = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.test(path)) throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/decisions${data.path}`,
      data.body,
      data.key,
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
