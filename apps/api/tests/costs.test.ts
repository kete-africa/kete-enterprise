import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { usageStore } from '../src/platform/usage.js';
import { startApi, tokenFor } from './support.js';

// Spec 037: what each model call cost, from the configured prices, in the administrators' report.

process.env.KETE_AI_PRICES = JSON.stringify({ 'gpt-test': { input: 1.25, output: 10 } });

let db: TestSchema;
const api = createApi();
let admin = '';
let member = '';

const get = async (token: string, path: string) => {
  const response = await api.request(`/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  db = await startApi();
  admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  member = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
});

afterAll(async () => {
  delete process.env.KETE_AI_PRICES;
  await db?.drop();
});

describe('the cost of model calls', () => {
  it('is recorded with each call and reported to administrators only', async () => {
    const person = { kind: 'person' as const, id: 'usr_ama', channel: 'chat' as const };
    await usageStore().record(
      {
        organizationId: 'org_kya',
        actor: person,
        purpose: 'chat',
        model: 'openai.responses:gpt-test',
      },
      { inputTokens: 1_000_000, outputTokens: 100_000, modelCalls: 3 },
    );
    await usageStore().record(
      { organizationId: 'org_kya', actor: person, purpose: 'reading', model: 'other:unpriced' },
      { inputTokens: 500, outputTokens: 0, modelCalls: 1 },
    );
    expect((await get(member, '/assistant/usage')).status).toBe(403);
    const usage = (await get(admin, '/assistant/usage')).body;
    expect(usage.purposes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: 'chat', costMicroUsd: 2_250_000 }),
        expect.objectContaining({ purpose: 'reading', costMicroUsd: null }),
      ]),
    );
    expect(usage.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purpose: 'chat',
          actorId: 'usr_ama',
          calls: 3,
          costMicroUsd: 2_250_000,
        }),
      ]),
    );
  });
});
