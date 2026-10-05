import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader } from '../src/features/registry/index.js';
import { useAnalysisModel } from '../src/features/todo/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 047: a decision in « À faire » — read in full by whoever it concerns, analysed for the one
// who decides with her read-only tools and its sources, discussed by the people it concerns.

let db: TestSchema;
const api = createApi();
const t: Record<string, string> = {};
let requestId = '';
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `todo-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const field = (answer: { body: Answer }, name: string) => String(answer.body[name] ?? '');

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };
const says = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: stop,
  usage,
  warnings: [],
});

beforeAll(async () => {
  db = await startApi();
  useCardReader(async () => ({
    product: 'prd_test',
    name: 'Test',
    version: '1.0.0',
    governance: {
      owner: { name: 'Owner' },
      dataCategories: ['personal'],
      ai: { used: false },
      criticality: 'medium',
    },
  }));
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  for (const who of ['awa', 'kofi', 'zoe']) {
    t[who] = await tokenFor(`usr_${who}`, { role: 'member', name: who });
  }
  const kofi = field(
    await post(t.admin, '/structure/people', { name: 'Kofi Mensah', accountUserId: 'usr_kofi' }),
    'personId',
  );
  await post(t.admin, '/structure/people', { name: 'Awa Diallo', accountUserId: 'usr_awa' });
  expect(
    (
      await post(t.admin, '/decisions/circuits', {
        subject: 'registry.promotion',
        name: 'Promotion des ressources',
        steps: [{ rule: 'person', personId: kofi }],
      })
    ).status,
  ).toBe(201);
  const resource = field(
    await post(t.awa, '/registry/resources', {
      kind: 'app',
      name: 'Suivi des batteries',
      address: 'https://batteries.example.test',
    }),
    'resourceId',
  );
  requestId = field(
    await post(t.awa, `/registry/resources/${resource}/promotions`, {
      target: { kind: 'organization' },
    }),
    'decisionRequestId',
  );
  expect(requestId).toMatch(/^drq_/);
});

afterAll(async () => {
  useAnalysisModel(undefined);
  await db?.drop();
});

describe('a decision in « À faire »', () => {
  it('is read in full by whoever it concerns, decided by its approver only', async () => {
    const kofi = await call(t.kofi, 'GET', `/todo/decisions/${requestId}`);
    expect(kofi.status).toBe(200);
    expect(kofi.body).toMatchObject({
      mayDecide: true,
      requesterName: 'Awa Diallo',
      analysis: null,
      comments: [],
    });
    expect((await call(t.awa, 'GET', `/todo/decisions/${requestId}`)).body.mayDecide).toBe(false);
    expect((await call(t.zoe, 'GET', `/todo/decisions/${requestId}`)).status).toBe(404);
  });

  it('is analysed for her, each point with its source only when one backs it', async () => {
    useAnalysisModel(
      new MockLanguageModelV4({
        doGenerate: [
          says('La ressource est déjà utilisée par l’agence de Lomé.'),
          says(
            JSON.stringify({
              recommendation: 'approve',
              confidence: 'high',
              points: [{ text: 'Déjà utilisée par l’agence de Lomé.', source: 1 }],
            }),
          ),
        ],
      }),
    );
    const analysed = await post(t.kofi, `/todo/decisions/${requestId}/analysis`);
    expect(analysed.status).toBe(200);
    // No source came back from the tools: the point has none, and the assistant is not « sure ».
    expect(analysed.body.analysis).toMatchObject({
      recommendation: 'approve',
      confidence: 'medium',
      points: [{ text: 'Déjà utilisée par l’agence de Lomé.', source: null }],
    });
    const read = await call(t.kofi, 'GET', `/todo/decisions/${requestId}`);
    expect(read.body.analysis).toMatchObject({ recommendation: 'approve' });
    // Hers alone: the requester does not see the approver's analysis.
    expect((await call(t.awa, 'GET', `/todo/decisions/${requestId}`)).body.analysis).toBeNull();
    expect((await post(t.zoe, `/todo/decisions/${requestId}/analysis`)).status).toBe(404);
    useAnalysisModel(null);
    expect((await post(t.kofi, `/todo/decisions/${requestId}/analysis`)).body).toMatchObject({
      error: 'assistant_unavailable',
    });
  });

  it('is discussed by the people it concerns, the others who wrote told', async () => {
    const written = await post(t.kofi, `/todo/decisions/${requestId}/comments`, {
      body: 'Qui la maintient après la mise en service ?',
    });
    expect(written.status).toBe(201);
    const told = (await call(t.awa, 'GET', '/notifications')).body.notifications as {
      title: string;
      href: string;
    }[];
    expect(told[0]).toMatchObject({
      title: expect.stringContaining('Kofi Mensah'),
      href: `/a-faire?item=decision:${requestId}`,
    });
    expect(
      (await post(t.awa, `/todo/decisions/${requestId}/comments`, { body: 'L’équipe SAV.' }))
        .status,
    ).toBe(201);
    const comments = (await call(t.kofi, 'GET', `/todo/decisions/${requestId}`)).body.comments as {
      authorName: string;
      body: string;
    }[];
    expect(comments.map((c) => c.authorName)).toEqual(['Kofi Mensah', 'Awa Diallo']);
    expect((await post(t.zoe, `/todo/decisions/${requestId}/comments`, { body: 'x' })).status).toBe(
      404,
    );
    expect(
      (await post(t.kofi, `/todo/decisions/${requestId}/comments`, { body: ' ' })).status,
    ).toBe(422);
  });
});
