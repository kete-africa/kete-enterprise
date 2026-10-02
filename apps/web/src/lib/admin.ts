import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, callPublic, sendGesture } from '@/platform/api';
import type { ModuleKey } from './me';
import type { Chart } from './structure';

// The Administration's own calls (spec 010): people and their accounts, modules, the test outbox.

export interface Organization {
  modules: Record<ModuleKey, boolean>;
  settings: { demo: boolean };
}

export const fetchOrganization = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Organization>(getRequest(), '/v1/organization'),
);

export interface OutboxMessage {
  messageId: string;
  recipient: string;
  subject: string;
  purpose: string;
  createdAt: string;
}

export const fetchOutbox = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ mode: 'capture' | 'send'; messages: OutboxMessage[] }>(getRequest(), '/v1/mail/outbox'),
);

export const fetchOutboxMessage = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const messageId = (input as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId !== 'string' || !/^mail_[0-9a-f-]{8,64}$/.test(messageId)) {
      throw new Error('Unknown e-mail.');
    }
    return { messageId };
  })
  .handler(({ data }) =>
    callApi<{ subject: string; recipient: string; html: string; text: string }>(
      getRequest(),
      `/v1/mail/outbox/${data.messageId}`,
    ),
  );

export interface ImportReport {
  created: number;
  refused: { row: number; code: string }[];
}

const paths = [
  /^\/structure\/people\/import$/,
  /^\/structure\/people\/prs_[0-9a-f-]+$/,
  /^\/structure\/people\/prs_[0-9a-f-]+\/account$/,
  /^\/organization\/modules$/,
];

/** A gesture of the Administration: each is a named command of the API. */
export const administer = createServerFn({ method: 'POST' })
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
    const answer = await sendGesture<ImportReport>(
      getRequest(),
      `/v1${data.path}`,
      data.body,
      data.key,
    );
    return answer.ok
      ? { ok: true, error: null, data: answer.data }
      : { ok: false, error: answer.error, data: null };
  });

/** The people of the organization, as the Administration lists them. */
export const fetchPeople = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Chart>(getRequest(), '/v1/structure'),
);

export interface LinkInfo {
  purpose: string;
  reference: string;
  person: { name: string };
}

/** What a personal link opens: without an account (spec 010). */
export const fetchLink = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const token = (input as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      return { token: '' };
    }
    return { token };
  })
  .handler(async ({ data }) => {
    if (!data.token) return null;
    const answer = await callPublic<LinkInfo>(`/passes/${data.token}`);
    return answer.ok ? answer.data : null;
  });
