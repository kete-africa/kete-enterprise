import type { TestSchema } from '@kete/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import {
  SubscriptionLostError,
  useSubscriptionAgent,
  type SubscriptionAgent,
} from '../src/features/ai/index.js';
import { useModel } from '../src/features/assistant/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 026b: « Pay with » — her answers paid by the organization, her key, or her own
// subscription, signed in on her own machine. Kete Enterprise keeps only which machine is hers.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `sub-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Answer };
}

async function stream(token: string, body: object) {
  const response = await api.request('/v1/assistant/chat/stream', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) return { status: response.status, events: [JSON.parse(text) as Answer] };
  return {
    status: response.status,
    events: text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Answer),
  };
}

/** The organization's model: one sentence. */
function organizationModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start' as const, warnings: [] },
          { type: 'text-start' as const, id: 't1' },
          { type: 'text-delta' as const, id: 't1', delta: 'Le modèle de l’organisation.' },
          { type: 'text-end' as const, id: 't1' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: {
              inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 2, text: 2, reasoning: undefined },
            },
          },
        ],
      }) as never,
    }),
  });
}

/** Her subscription's agent, faked: nothing runs, every call is recorded. */
const agent = {
  signed: false,
  lost: false,
  prompts: [] as string[],
  calls: [] as string[],
};
const fake: SubscriptionAgent = {
  available: () => true,
  async startSignIn(machineId) {
    agent.calls.push(`start ${machineId}`);
    return { machineId: 'bx_kofi0001', url: 'https://sign-in.example/device', code: 'ABCD-1234' };
  },
  async signedIn(machineId) {
    agent.calls.push(`check ${machineId}`);
    return agent.signed;
  },
  async answer(machineId, input) {
    if (agent.lost) throw new SubscriptionLostError('Signed out.');
    agent.calls.push(`answer ${machineId}`);
    agent.prompts.push(input.prompt);
    return 'Réponse de son abonnement.';
  },
  async rest(machineId) {
    agent.calls.push(`rest ${machineId}`);
  },
  async forget(machineId) {
    agent.calls.push(`forget ${machineId}`);
  },
};

beforeAll(async () => {
  db = await startApi();
  useModel(organizationModel());
  useSubscriptionAgent(fake);
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
});

afterAll(async () => {
  useModel(undefined);
  useSubscriptionAgent(undefined);
  await db?.drop();
});

const payersOfKofi = async () => (await call(t.kofi, 'GET', '/assistant')).body.payers;

describe('pay with her own subscription', () => {
  it('signs her in on her own machine, without ever showing the machine', async () => {
    expect((await call(t.kofi, 'GET', '/ai/connection')).body).toMatchObject({
      subscriptionsAvailable: true,
      subscription: null,
    });
    expect(await payersOfKofi()).toEqual(['organization']);

    const started = await call(t.kofi, 'POST', '/ai/subscription', {});
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      url: 'https://sign-in.example/device',
      code: 'ABCD-1234',
      subscription: { state: 'signing_in' },
    });
    expect(started.text).not.toContain('bx_kofi0001');

    // Not signed in yet: she is still signing in.
    const waiting = await call(t.kofi, 'POST', '/ai/subscription/check', {});
    expect(waiting.body).toMatchObject({ subscription: { state: 'signing_in' } });
    expect(await payersOfKofi()).toEqual(['organization']);

    agent.signed = true;
    const done = await call(t.kofi, 'POST', '/ai/subscription/check', {});
    expect(done.body).toMatchObject({ subscription: { state: 'connected' } });
    // Signed in, her machine rests until she writes.
    expect(agent.calls).toContain('rest bx_kofi0001');
    expect(await payersOfKofi()).toEqual(['organization', 'subscription']);
  });

  it('answers her with her subscription when she chooses it, the organization otherwise', async () => {
    const own = await stream(t.kofi, { message: 'Résume ma semaine', payer: 'subscription' });
    expect(own.status).toBe(200);
    expect(own.events).toContainEqual({ type: 'text', delta: 'Réponse de son abonnement.' });
    expect(agent.prompts.at(-1)).toContain('Elle : Résume ma semaine');
    const organization = await stream(t.kofi, { message: 'Et demain ?', payer: 'organization' });
    expect(organization.events).toContainEqual({
      type: 'text',
      delta: 'Le modèle de l’organisation.',
    });
    // Her subscription's answer is journaled as hers: a call, no token for the organization.
    const { rows } = await db.owner.query<{ purpose: string; tokens: number }>(
      `select purpose, input_tokens + output_tokens as tokens from ${db.schema}.kete_ai_usage
        where purpose = 'chat:subscription'`,
    );
    expect(rows).toEqual([{ purpose: 'chat:subscription', tokens: 0 }]);
  });

  it('says when her subscription is signed out', async () => {
    agent.lost = true;
    const lost = await stream(t.kofi, { message: 'Bonjour', payer: 'subscription' });
    expect(lost.events).toContainEqual({ type: 'error', code: 'subscription_lost' });
    agent.lost = false;
  });

  it('follows the organization’s policy', async () => {
    expect((await call(t.admin, 'POST', '/ai/policy', { personal: 'off' })).status).toBe(201);
    const refused = await stream(t.kofi, { message: 'Bonjour', payer: 'subscription' });
    expect(refused).toMatchObject({ status: 409, events: [{ error: 'payer_refused' }] });
    expect((await call(t.kofi, 'POST', '/ai/subscription', {})).body).toMatchObject({
      error: 'personal_off',
    });
    expect(await payersOfKofi()).toEqual(['organization']);
    // Required: the organization pays for nobody; her subscription answers.
    await call(t.admin, 'POST', '/ai/policy', { personal: 'required' });
    expect(await payersOfKofi()).toEqual(['subscription']);
    const own = await stream(t.kofi, { message: 'Bonjour' });
    expect(own.events).toContainEqual({ type: 'text', delta: 'Réponse de son abonnement.' });
    await call(t.admin, 'POST', '/ai/policy', { personal: 'allowed' });
  });

  it('forgets her machine and her sign-in when she removes it', async () => {
    const removed = await call(t.kofi, 'POST', '/ai/subscription/remove', {});
    expect(removed.body).toEqual({ subscription: null });
    expect(agent.calls).toContain('forget bx_kofi0001');
    expect(await payersOfKofi()).toEqual(['organization']);
  });
});
