import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, callPublic, sendGesture } from '@/platform/api';

// The performance as the API serves it (spec 012).

export type Colour = 'green' | 'orange' | 'red';

export interface ReviewLine {
  position: number;
  name: string;
  formula: string;
  source: string;
  frequency: string;
  reliable: boolean;
  targetText: string;
  thresholdText: string;
  direction: 'higher' | 'lower' | null;
  weight: number | null;
  kind: 'scored' | 'penalizing' | 'blocking' | 'malus';
  value: number | null;
  colour: Colour | null;
  proof: string | null;
}

export interface Split {
  individual: number;
  collective: number;
  collectiveLabel: string | null;
  group: number;
  note: string | null;
}

export type ReviewStatus =
  'open' | 'measured' | 'manager_signed' | 'signed' | 'validated' | 'missed';

export interface Review {
  reviewId: string;
  quarterId: string;
  personId: string;
  personName: string;
  positionId: string;
  positionTitle: string;
  unitId: string;
  managerPersonId: string | null;
  managerName: string | null;
  profileTitle: string;
  weights: Split;
  status: ReviewStatus;
  acknowledgedAt: string | null;
  record: { facts?: string; difficulties?: string; support?: string; protocols?: number | null };
  managerSignedAt: string | null;
  personObservations: string | null;
  personSignedAt: string | null;
  validatedAt: string | null;
  individual: number | null;
  collective: number | null;
  group: number | null;
  factor: number | null;
  fallback: boolean;
  lines: ReviewLine[];
}

export interface Quarter {
  quarterId: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: 'draft' | 'open' | 'measured' | 'closed';
  progressive: boolean;
  scale: { green: number; orange: number; red: number };
  groupFactor: number | null;
  groupTriggered: boolean;
  units: { unitId: string; factor: number }[];
}

export interface Profile {
  profileId: string;
  title: string;
  category: string;
  direction: string | null;
  weights: Split;
  source: string;
  lines: (ReviewLine & { indicatorId: string; leading: boolean })[];
  positions: string[];
}

export const fetchQuarters = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest();
  const [quarters, profiles] = await Promise.all([
    callApi<{ quarters: Quarter[] }>(request, '/v1/performance'),
    callApi<{ profiles: Profile[] }>(request, '/v1/performance/profiles').catch(() => ({
      profiles: [] as Profile[],
    })),
  ]);
  return { ...quarters, ...profiles };
});

const isId = (prefix: string, value: unknown): value is string =>
  typeof value === 'string' && new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`).test(value);

export const fetchQuarter = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const quarterId = (input as { quarterId?: unknown } | null)?.quarterId;
    if (!isId('pqt', quarterId)) throw new Error('Unknown quarter.');
    return { quarterId };
  })
  .handler(({ data }) =>
    callApi<{ quarter: Quarter; reviews: Review[] }>(
      getRequest(),
      `/v1/performance/quarters/${data.quarterId}`,
    ),
  );

export const fetchReview = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const reviewId = (input as { reviewId?: unknown } | null)?.reviewId;
    if (!isId('rvw', reviewId)) throw new Error('Unknown review.');
    return { reviewId };
  })
  .handler(async ({ data }) => {
    const request = getRequest();
    const { review } = await callApi<{ review: Review }>(
      request,
      `/v1/performance/reviews/${data.reviewId}`,
    );
    const quarters = await callApi<{ quarters: Quarter[] }>(request, '/v1/performance').catch(
      () => null,
    );
    return {
      review,
      quarter: quarters?.quarters.find((q) => q.quarterId === review.quarterId) ?? null,
    };
  });

export const fetchMyPerformance = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ reviews: Review[]; team: Review[] }>(getRequest(), '/v1/performance/mine'),
);

const paths = [
  /^\/quarters$/,
  /^\/quarters\/pqt_[0-9a-f-]+\/(open|close-measures|close|group)$/,
  /^\/quarters\/pqt_[0-9a-f-]+\/units\/unt_[0-9a-f-]+$/,
  /^\/reviews\/rvw_[0-9a-f-]+\/(measures|from-survey|record|sign|validate|acknowledge)$/,
  /^\/positions\/pos_[0-9a-f-]+\/profile$/,
];

type Data = Record<string, string | number | boolean | null>;

/** A gesture on the performance: each is a named command of the API. */
export const performanceGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.some((p) => p.test(path))) {
      throw new Error('Unknown gesture.');
    }
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<Data>(
      getRequest(),
      `/v1/performance${data.path}`,
      data.body,
      data.key,
    );
    return answer.ok
      ? { ok: true, error: null, data: answer.data }
      : { ok: false, error: answer.error, data: null };
  });

export const fetchLinkReview = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const token = (input as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error('Unknown link.');
    }
    return { token };
  })
  .handler(async ({ data }) => {
    const answer = await callPublic<{ review: Review; quarter: Quarter }>(
      `/performance/${data.token}`,
    );
    return answer.ok ? answer.data : null;
  });

/** Acknowledges a grid or signs a record through a personal link. */
export const linkReviewGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { token, action, observations, key } = (input ?? {}) as Record<string, unknown>;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new Error('Unknown link.');
    }
    if (action !== 'acknowledge' && action !== 'sign') throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8)
      throw new Error('An idempotency key is required.');
    return {
      token,
      action,
      observations: typeof observations === 'string' ? observations : undefined,
      key,
    };
  })
  .handler(async ({ data }) => {
    const answer = await callPublic(`/performance/${data.token}/${data.action}`, {
      method: 'POST',
      body: data.observations ? { observations: data.observations } : {},
      idempotencyKey: data.key,
    });
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

/** A factor between 0 and 1, as people read it. */
export const percent = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 1000) / 10} %`;
