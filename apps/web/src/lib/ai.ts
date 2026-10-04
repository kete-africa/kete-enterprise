import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Each person's own AI connection or subscription and the organization's policy (specs 026, 026b),
// as the API serves them.

export const providers = ['openai', 'anthropic', 'mistral', 'deepseek'] as const;
export type Provider = (typeof providers)[number];
export type PersonalPolicy = 'off' | 'allowed' | 'required';

export interface ConnectionScreen {
  policy: PersonalPolicy;
  /** Whether the instance can keep a secret (its key is set). */
  available: boolean;
  connection: {
    provider: Provider;
    model: string;
    keyEnd: string;
    createdAt: string;
    lastUsedAt: string | null;
  } | null;
  /** Whether this instance gives a person a machine of her own for her subscription. */
  subscriptionsAvailable: boolean;
  subscription: Subscription | null;
}

export interface Subscription {
  state: 'signing_in' | 'connected';
  createdAt: string;
  connectedAt: string | null;
  lastUsedAt: string | null;
}

export const fetchConnection = createServerFn({ method: 'GET' }).handler(() =>
  callApi<ConnectionScreen>(getRequest(), '/v1/ai/connection'),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** Brings her own key: tried on its provider, kept sealed, never shown again. */
export const saveConnection = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      provider: text(v.provider, 20),
      model: text(v.model, 80),
      apiKey: text(v.apiKey, 400),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(getRequest(), '/v1/ai/connection', data, crypto.randomUUID());
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

export const removeConnection = createServerFn({ method: 'POST' }).handler(async () => {
  const answer = await sendGesture(
    getRequest(),
    '/v1/ai/connection/remove',
    {},
    crypto.randomUUID(),
  );
  return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
});

/** Starts her sign-in on her own machine: the page to open and the code to enter there. */
export const startSubscription = createServerFn({ method: 'POST' }).handler(async () => {
  const answer = await sendGesture<{ url: string; code: string }>(
    getRequest(),
    '/v1/ai/subscription',
    {},
    crypto.randomUUID(),
  );
  return answer.ok
    ? { ok: true as const, url: answer.data.url, code: answer.data.code, error: null }
    : { ok: false as const, url: null, code: null, error: answer.error };
});

/** Whether she finished signing in. */
export const checkSubscription = createServerFn({ method: 'POST' }).handler(async () => {
  const answer = await sendGesture<{ subscription: Subscription | null }>(
    getRequest(),
    '/v1/ai/subscription/check',
    {},
    crypto.randomUUID(),
  );
  return answer.ok
    ? { ok: true as const, subscription: answer.data.subscription, error: null }
    : { ok: false as const, subscription: null, error: answer.error };
});

/** Removes her subscription: her machine goes, and her sign-in with it. */
export const removeSubscription = createServerFn({ method: 'POST' }).handler(async () => {
  const answer = await sendGesture(
    getRequest(),
    '/v1/ai/subscription/remove',
    {},
    crypto.randomUUID(),
  );
  return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
});

export const setPersonalPolicy = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const personal = (input as { personal?: unknown } | null)?.personal;
    if (personal !== 'off' && personal !== 'allowed' && personal !== 'required') {
      throw new Error('off, allowed or required.');
    }
    return { personal };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(getRequest(), '/v1/ai/policy', data, crypto.randomUUID());
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
