import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Her notifications and her devices (spec 030), as the API serves them.

export interface NotificationItem {
  notificationId: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}

export const fetchNotifications = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ notifications: NotificationItem[]; unread: number; pushKey: string | null }>(
    getRequest(),
    '/v1/notifications',
  ),
);

export const readAllNotifications = createServerFn({ method: 'POST' }).handler(async () => {
  const answer = await sendGesture(
    getRequest(),
    '/v1/notifications/read',
    { all: true },
    crypto.randomUUID(),
  );
  return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
});

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** A device of hers, subscribed by its browser, told from now on. */
export const subscribeDevice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    return {
      endpoint: text(v.endpoint, 1000),
      keys: { p256dh: text(v.keys?.p256dh, 200), auth: text(v.keys?.auth, 100) },
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      '/v1/notifications/push',
      data,
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

export const unsubscribeDevice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    endpoint: text((input as { endpoint?: unknown } | null)?.endpoint, 1000),
  }))
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      '/v1/notifications/push/remove',
      data,
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

export interface SearchResult {
  kind: 'conversation' | 'action' | 'decision' | 'person' | 'app' | 'document';
  title: string;
  detail: string | null;
  href: string;
}

export const searchEverywhere = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ q: text((input as { q?: unknown } | null)?.q, 200) }))
  .handler(({ data }) =>
    data.q.trim().length < 2
      ? Promise.resolve({ query: data.q, results: [] as SearchResult[] })
      : callApi<{ query: string; results: SearchResult[] }>(
          getRequest(),
          `/v1/search?q=${encodeURIComponent(data.q)}`,
        ),
  );
