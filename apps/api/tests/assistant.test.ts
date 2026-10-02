import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 014: the assistant acts for the person through the gateway's tools, with her rights; the
// morning briefing is written by the model from the facts, or by rules without one.

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
      'idempotency-key': `assistant-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: 'stop' };

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (await post(t.admin, '/structure/units', { unitTypeId: type, name: 'KYA' })).body
    .unitId;
  const position = (await post(t.admin, '/structure/positions', { unitId: unit, title: 'Chef' }))
    .body.positionId;
  const person = (
    await post(t.admin, '/structure/people', { name: 'Kofi', accountUserId: 'usr_kofi' })
  ).body.personId as string;
  await post(t.admin, '/structure/assignments', {
    personId: person,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  await post(t.admin, '/organization/modules', { module: 'meetings', enabled: true });
  await post(t.admin, '/actions', {
    title: 'Relancer le client',
    responsiblePersonId: person,
    dueOn: '2026-09-01',
  });
});

afterAll(async () => {
  useModel(undefined);
  await db?.drop();
});

describe('the morning briefing', () => {
  it('is written by rules when no model is configured', async () => {
    useModel(undefined);
    const briefing = (await get(t.kofi, '/assistant/briefing')).body;
    expect(briefing.generatedBy).toBe('rules');
    expect(String(briefing.text)).toContain('Relancer le client');
  });

  it('is written by the model from the facts, and kept for the day', async () => {
    useModel(
      new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: 'text', text: 'Une action en retard : relancer le client.' }],
          finishReason: stop,
          usage,
          warnings: [],
        },
      }),
    );
    const fresh = (await post(t.kofi, '/assistant/briefing')).body;
    expect(fresh).toMatchObject({
      generatedBy: 'model',
      text: 'Une action en retard : relancer le client.',
    });
    expect((await get(t.kofi, '/assistant/briefing')).body.text).toBe(fresh.text);
  });
});

describe('the assistant', () => {
  it('reads the person’s day through her own tools, and records the use of the model', async () => {
    useModel(
      new MockLanguageModelV4({
        doGenerate: [
          {
            content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'my_day', input: '{}' }],
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage,
            warnings: [],
          },
          {
            content: [{ type: 'text', text: 'D’après vos actions ouvertes, une est en retard.' }],
            finishReason: stop,
            usage,
            warnings: [],
          },
        ],
      }),
    );
    const answer = await post(t.kofi, '/assistant/chat', {
      messages: [{ role: 'user', content: 'Qu’est-ce qui est en retard ?' }],
    });
    expect(answer.body).toMatchObject({ tools: ['my_day'] });
    const used = (await get(t.admin, '/assistant/usage')).body.purposes as { purpose: string }[];
    expect(used.map((u) => u.purpose).sort()).toEqual(['briefing', 'chat']);
    expect((await get(t.kofi, '/assistant/usage')).status).toBe(403);
  });

  it('says so when no model is configured', async () => {
    useModel(undefined);
    const answer = await post(t.kofi, '/assistant/chat', {
      messages: [{ role: 'user', content: 'Bonjour' }],
    });
    expect(answer.body.error).toBe('assistant_unavailable');
  });
});
