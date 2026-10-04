import { randomBytes } from 'node:crypto';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { modelChoiceFor, useKeyChecker } from '../src/features/ai/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 026: whoever wants her assistant and agents to run on her own tokens brings her key; the
// organization allows it, requires it, or pays for everyone. The key is sealed, never returned.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '' };
let key = 0;
const KEY = `sk-test-${'x'.repeat(30)}abcd`;
const organizationModel = { provider: 'openai' as const, model: 'org-model', apiKey: 'org-key' };

type Answer = Record<string, unknown>;
async function call(
  token: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: object,
) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `ai-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, text: await response.text() };
}
const json = (r: { text: string }) => JSON.parse(r.text) as Answer;

beforeAll(async () => {
  db = await startApi();
  process.env.KETE_SECRETS_KEY = randomBytes(32).toString('base64');
  useKeyChecker(async (_provider, apiKey) => (apiKey === KEY ? 'ok' : 'invalid'));
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.kofi = await tokenFor('usr_kofi');
});

afterAll(async () => {
  delete process.env.KETE_SECRETS_KEY;
  await db?.drop();
});

const choice = () =>
  transaction('org_kya', (tx) => modelChoiceFor(tx, 'usr_kofi', organizationModel));

describe('a person’s own AI connection', () => {
  it('runs on the organization’s model until she brings her key', async () => {
    expect(json(await call(t.kofi, 'GET', '/ai/connection'))).toEqual({
      policy: 'allowed',
      available: true,
      connection: null,
      subscriptionsAvailable: false,
      subscription: null,
    });
    expect(await choice()).toEqual({ config: organizationModel, personal: false });
  });

  it('refuses a key its provider refuses, and keeps a good one sealed, never returned', async () => {
    const wrong = await call(t.kofi, 'POST', '/ai/connection', {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      apiKey: `sk-wrong-${'y'.repeat(30)}`,
    });
    expect(wrong.status).toBe(422);
    const saved = await call(t.kofi, 'POST', '/ai/connection', {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      apiKey: KEY,
    });
    expect(saved.status).toBe(201);
    expect(json(saved)).toMatchObject({
      connection: { provider: 'openai', model: 'gpt-6.1-sol', keyEnd: 'abcd' },
    });
    expect(saved.text).not.toContain(KEY);
    expect((await call(t.kofi, 'GET', '/ai/connection')).text).not.toContain(KEY);
    const { rows } = await db.owner.query<{ sealed_key: string }>(
      `select sealed_key from ${db.schema}.ai_connections where user_id = 'usr_kofi'`,
    );
    expect(rows[0]?.sealed_key).not.toContain(KEY);
  });

  it('then answers her on her own tokens', async () => {
    expect(await choice()).toEqual({
      config: { provider: 'openai', model: 'gpt-6.1-sol', apiKey: KEY },
      personal: true,
    });
  });

  it('follows the organization’s policy, set by its administrators only', async () => {
    expect((await call(t.kofi, 'POST', '/ai/policy', { personal: 'off' })).status).toBe(403);
    expect((await call(t.admin, 'POST', '/ai/policy', { personal: 'off' })).status).toBe(201);
    expect(await choice()).toEqual({ config: organizationModel, personal: false });
    const refused = await call(t.kofi, 'POST', '/ai/connection', {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      apiKey: KEY,
    });
    expect(json(refused)).toMatchObject({ error: 'personal_off' });
    await call(t.admin, 'POST', '/ai/policy', { personal: 'required' });
    await call(t.kofi, 'POST', '/ai/connection/remove', {});
    // Required, and she has none: no model answers her — the organization pays for nobody.
    expect(await choice()).toBeNull();
  });
});
