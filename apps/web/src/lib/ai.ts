import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Each person's own AI connection and the organization's policy (spec 026), as the API serves them.

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
