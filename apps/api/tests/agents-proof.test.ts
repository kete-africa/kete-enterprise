import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { runWaitingEvaluations, useEvaluationModel } from '../src/features/agents/index.js';
import { listMemories } from '../src/features/assistant/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 106 (kete-core ADR 0018; doctrine D-062, R18, R21): Kete and the agents share one memory of
// a person, kept only while she agrees; an agent has a budget of its own and waits when it is
// spent; and it proves itself — its test set replayed with its tools played dry after any change of
// its job — or it is paused « à revoir ».

const ORG = 'org_agents_proof';

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
let key = 0;
const ids = {} as Record<'agent', string>;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `agents-proof-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const get = (token: string, path: string) => call(token, 'GET', path);
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
/** A model that answers in words and calls nothing — whatever it is asked. */
const silent = () =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: 'Je regarde.' }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
  });

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.awa = await tokenFor('usr_awa', { name: 'Awa', org: ORG });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi', org: ORG });
  await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
  ids.agent = String(
    (
      await post(t.awa, '/agents', {
        name: 'Agent Relances',
        kind: 'personal',
        mission: 'Relancer les clients en retard.',
        autonomyMax: 3,
        watches: ['decisions'],
      })
    ).body.agentId,
  );
});

afterAll(async () => {
  useEvaluationModel(undefined);
  await db?.drop();
});

describe('one memory of her, under her agreement (FR-001, FR-002)', () => {
  it('keeps what she asks, which agreed for her; shown to her with who noted it', async () => {
    expect(
      (await post(t.awa, '/assistant/memories', { text: 'Mes rapports en FCFA.' })).status,
    ).toBe(201);
    const mine = (await get(t.awa, '/assistant/memories')).body as {
      memories: { text: string; origin: string }[];
      consent: { enabled: boolean };
    };
    expect(mine.memories).toEqual([
      expect.objectContaining({ text: 'Mes rapports en FCFA.', origin: 'person' }),
    ]);
    expect(mine.consent.enabled).toBe(true);
    // Kofi sees nothing of hers.
    expect(((await get(t.kofi, '/assistant/memories')).body.memories as unknown[]).length).toBe(0);
  });

  it('is read by Kete and her agents only while she agrees; erased at once when she says', async () => {
    const read = () => transaction(ORG, (dbx) => listMemories(dbx, 'usr_awa'));
    expect((await read()).length).toBe(1);
    expect(
      (await call(t.awa, 'PUT', '/assistant/memories/consent', { enabled: false })).status,
    ).toBe(200);
    expect(await read()).toEqual([]);
    // Withdrawn, nothing new is kept from an agent; what was kept stays hers to read and erase.
    await call(t.awa, 'PUT', '/assistant/memories/consent', { enabled: true });
    expect((await post(t.awa, '/assistant/memories/erase')).body).toEqual({ erased: 1 });
    expect(await read()).toEqual([]);
  });
});

describe('a budget of its own (FR-003)', () => {
  it('is set by its person, never a colleague; shows what it spent this month', async () => {
    expect(
      (await post(t.kofi, `/agents/${ids.agent}/budget`, { monthlyTokens: 1000 })).status,
    ).toBe(403);
    expect((await post(t.awa, `/agents/${ids.agent}/budget`, { monthlyTokens: 1000 })).status).toBe(
      201,
    );
    expect((await get(t.awa, `/agents/${ids.agent}/budget`)).body).toMatchObject({
      monthlyTokens: 1000,
      spentTokens: 0,
    });
  });
});

describe('it proves itself (FR-004, FR-005)', () => {
  it('replays its cases after a change of its job; failing, it is paused « à revoir »', async () => {
    expect(
      (
        await post(t.awa, `/agents/${ids.agent}/cases`, {
          name: 'Relance échue',
          ask: 'La facture F-4 est échue depuis 5 jours.',
          prepares: ['actions_propose'],
          neverSays: ['payez immédiatement'],
        })
      ).status,
    ).toBe(201);
    // A change of its job asks for an evaluation; a model that prepares nothing fails it.
    expect(
      (await post(t.awa, `/threads/agents/${ids.agent}/job`, { covers: ['relances'] })).status,
    ).toBe(200);
    useEvaluationModel(silent());
    expect(await runWaitingEvaluations()).toBe(1);
    const proven = (await get(t.awa, `/agents/${ids.agent}/evaluations`)).body as {
      evaluations: {
        status: string;
        score: number;
        failures: { name: string; failures: string[] }[];
      }[];
      threshold: number;
    };
    expect(proven.threshold).toBe(0.8);
    expect(proven.evaluations[0]).toMatchObject({ status: 'failed', score: 0 });
    expect(proven.evaluations[0]?.failures[0]).toMatchObject({
      name: 'Relance échue',
      failures: ['did not prepare actions_propose'],
    });
    const { rows } = await db.owner.query<{ status: string }>(
      `select status from ${db.schema}.agents where agent_id = $1`,
      [ids.agent],
    );
    expect(rows[0]?.status).toBe('paused');
    // Its tools were played dry: nothing was done, no draft kept.
    const drafts = await db.owner.query(`select 1 from ${db.schema}.kete_drafts`);
    expect(drafts.rows).toHaveLength(0);
  });
});
