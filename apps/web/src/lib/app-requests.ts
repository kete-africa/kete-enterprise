import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// A person asks for an app; IT decides; the factory creates it (spec 021), as the API serves it.

export const dataCategories = [
  'none',
  'personal',
  'special',
  'children',
  'financial',
  'payment',
  'location',
  'credentials',
  'confidential',
] as const;
export type DataCategory = (typeof dataCategories)[number];

export const criticalities = ['low', 'medium', 'high', 'critical'] as const;
export type Criticality = (typeof criticalities)[number];

export type AppRequestStatus =
  | 'submitted'
  | 'refused'
  | 'withdrawn'
  | 'queued'
  | 'building'
  | 'ready'
  | 'coding'
  | 'review'
  | 'failed';

export interface AppRequest {
  requestId: string;
  requesterUserId: string;
  requesterName: string;
  slug: string;
  name: string;
  purpose: string;
  users: string;
  dataCategories: string[];
  criticality: Criticality;
  ownerContact: string;
  status: AppRequestStatus;
  decidedBy: string | null;
  refusalReason: string | null;
  repository: string | null;
  url: string | null;
  pullRequest: string | null;
  error: string | null;
  resourceId: string | null;
  createdAt: string;
}

export interface AppRequestsScreen {
  mine: AppRequest[];
  toDecide: AppRequest[];
  all: AppRequest[];
  reviews: boolean;
  factory: boolean;
}

export const fetchAppRequests = createServerFn({ method: 'GET' }).handler(() =>
  callApi<AppRequestsScreen>(getRequest(), '/v1/app-requests'),
);

const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^apr_[0-9a-z-]{8,64}$/.test(value);
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

export const fetchAppRequest = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const requestId = (input as { requestId?: unknown } | null)?.requestId;
    if (!isRequestId(requestId)) throw new Error('Unknown request.');
    return { requestId };
  })
  .handler(({ data }) =>
    callApi<{ request: AppRequest; reviews: boolean; factory: boolean }>(
      getRequest(),
      `/v1/app-requests/${encodeURIComponent(data.requestId)}`,
    ),
  );

export const submitAppRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    // The API checks every field; here, only their kind and size.
    return {
      key: text(v.key, 64),
      slug: text(v.slug, 40),
      name: text(v.name, 100),
      purpose: text(v.purpose, 4000),
      users: text(v.users, 1000),
      dataCategories: Array.isArray(v.dataCategories)
        ? v.dataCategories.filter((c): c is string => typeof c === 'string').slice(0, 9)
        : [],
      criticality: text(v.criticality, 20),
      ownerContact: text(v.ownerContact, 200),
    };
  })
  .handler(async ({ data }) => {
    const { key, ...body } = data;
    const answer = await sendGesture<{ requestId: string }>(
      getRequest(),
      '/v1/app-requests',
      body,
      key,
    );
    return answer.ok
      ? { ok: true, error: null, requestId: answer.data.requestId }
      : { ok: false, error: answer.error, requestId: null };
  });

/** Withdraw (her own), approve or refuse with a reason (IT), send again to the factory (IT). */
export const actOnAppRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const gestures = ['withdraw', 'approve', 'refuse', 'send'] as const;
    const gesture = gestures.find((g) => g === v.gesture);
    if (!isRequestId(v.requestId) || !gesture) throw new Error('Unknown gesture.');
    const reason = text(v.reason, 1000).trim();
    return {
      key: text(v.key, 64),
      requestId: v.requestId,
      gesture,
      ...(reason ? { reason } : {}),
    };
  })
  .handler(async ({ data }) => {
    const base = `/v1/app-requests/${encodeURIComponent(data.requestId)}`;
    const [path, body] =
      data.gesture === 'withdraw'
        ? [`${base}/withdraw`, {}]
        : data.gesture === 'send'
          ? [`${base}/send`, {}]
          : [
              `${base}/decide`,
              {
                decision: data.gesture,
                ...(data.gesture === 'refuse' && data.reason ? { reason: data.reason } : {}),
              },
            ];
    const answer = await sendGesture(getRequest(), path, body, data.key);
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
