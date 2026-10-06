import type { TestSchema } from '@kete/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 017: the assistant prepares a draft — it never decides; the person validates it from her
// screen and the command runs with her as actor; conversations are kept, one person each; the
// chat streams its text, its tools and its drafts.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kofi: '' };
let key = 0;
let kofi = '';

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `drafts-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

/** The chat's stream, read to its end: one JSON event per line. */
async function chat(token: string, body: object) {
  const response = await api.request('/v1/assistant/chat/stream', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    events: text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Answer),
  };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that first calls `tool` with `input`, then says `text`, streamed. */
function streamingModel(tool: string, input: object, text: string) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      step += 1;
      const chunks: object[] =
        step === 1
          ? [
              { type: 'stream-start' as const, warnings: [] },
              {
                type: 'tool-call' as const,
                toolCallId: `call_${step}`,
                toolName: tool,
                input: JSON.stringify(input),
              },
              {
                type: 'finish' as const,
                finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
                usage,
              },
            ]
          : [
              { type: 'stream-start' as const, warnings: [] },
              { type: 'text-start' as const, id: 't1' },
              { type: 'text-delta' as const, id: 't1', delta: text.slice(0, 10) },
              { type: 'text-delta' as const, id: 't1', delta: text.slice(10) },
              { type: 'text-end' as const, id: 't1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage,
              },
            ];
      // The model's own stream parts, as a provider sends them.
      return { stream: simulateReadableStream({ chunks }) as never };
    },
  });
}

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
  kofi = (await post(t.admin, '/structure/people', { name: 'Kofi', accountUserId: 'usr_kofi' }))
    .body.personId as string;
  await post(t.admin, '/structure/assignments', {
    personId: kofi,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  await post(t.admin, '/organization/modules', { module: 'meetings', enabled: true });
});

afterAll(async () => {
  useModel(undefined);
  await db?.drop();
});

describe('a draft prepared by the assistant', () => {
  let draftId = '';
  let conversationId = '';

  it('streams the text, the tool and the draft — and creates nothing', async () => {
    useModel(
      streamingModel(
        'actions_propose',
        { title: 'Relancer le fournisseur', responsiblePersonId: kofi, dueOn: '2026-10-09' },
        'J’ai préparé l’action : validez-la.',
      ),
    );
    const { status, events } = await chat(t.admin, { message: 'Crée une action pour Kofi' });
    expect(status).toBe(200);
    expect(events[0]).toMatchObject({ type: 'conversation' });
    conversationId = String(events[0]?.conversationId);
    const tool = events.find((e) => e.type === 'tool' && e.state === 'done') as
      { draft: { draftId: string; status: string } } | undefined;
    expect(tool?.draft).toMatchObject({ status: 'prepared' });
    draftId = tool?.draft.draftId ?? '';
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('J’ai préparé l’action : validez-la.');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const register = (await get(t.admin, '/actions?scope=all')).body.actions as unknown[];
    expect(register).toHaveLength(0);
  });

  it('keeps the conversation for its person only', async () => {
    const mine = (await get(t.admin, '/assistant/conversations')).body.conversations as {
      conversationId: string;
      title: string;
    }[];
    expect(mine).toEqual([
      expect.objectContaining({ conversationId, title: 'Crée une action pour Kofi' }),
    ]);
    const thread = (await get(t.admin, `/assistant/conversations/${conversationId}`)).body;
    expect(thread.messages).toMatchObject([
      { role: 'user', content: 'Crée une action pour Kofi' },
      { role: 'assistant', tools: [{ name: 'actions_propose', state: 'done' }] },
    ]);
    expect((await get(t.kofi, `/assistant/conversations/${conversationId}`)).status).toBe(404);
    expect((await get(t.kofi, '/assistant/conversations')).body.conversations).toEqual([]);
  });

  it('takes her opinion of an answer, once, changed as she likes — never on another’s (spec 053)', async () => {
    const judge = (token: string, helpful: boolean, reason?: string) =>
      post(token, '/assistant/feedback', {
        conversationId,
        messageId: 'msg-1',
        helpful,
        ...(reason ? { reason } : {}),
      });
    expect((await judge(t.admin, false, 'Il manquait le délai.')).status).toBe(201);
    expect((await judge(t.admin, true)).body).toEqual({ helpful: true });
    const { rows } = await db.owner.query<{ helpful: boolean; reason: string | null }>(
      'select helpful, reason from assistant_feedback',
    );
    expect(rows).toEqual([{ helpful: true, reason: null }]);
    expect((await judge(t.kofi, true)).status).toBe(404);
  });

  it('waits in the person’s drafts, and nobody else may decide it', async () => {
    const drafts = (await get(t.admin, '/assistant/drafts')).body.drafts as { draftId: string }[];
    expect(drafts.map((d) => d.draftId)).toEqual([draftId]);
    expect((await get(t.kofi, '/assistant/drafts')).body.drafts).toEqual([]);
    expect(
      (await post(t.kofi, `/assistant/drafts/${draftId}/decide`, { action: 'validate' })).status,
    ).toBe(403);
  });

  it('is validated by the person: the action exists, journaled with her as actor', async () => {
    const decided = await post(t.admin, `/assistant/drafts/${draftId}/decide`, {
      action: 'validate',
    });
    expect(decided).toMatchObject({ status: 200, body: { status: 'validated' } });
    const register = (await get(t.admin, '/actions?scope=all')).body.actions as {
      title: string;
    }[];
    expect(register.map((a) => a.title)).toEqual(['Relancer le fournisseur']);
    const again = await post(t.admin, `/assistant/drafts/${draftId}/decide`, { action: 'refuse' });
    expect(again.status).toBe(409);
  });
});

describe('the assistant’s rights', () => {
  it('cannot prepare what the person may not do', async () => {
    useModel(
      streamingModel(
        'actions_propose',
        { title: 'Rien', responsiblePersonId: kofi, dueOn: '2026-10-09' },
        'Je ne peux pas.',
      ),
    );
    const { events } = await chat(t.kofi, { message: 'Crée une action' });
    const tool = events.find((e) => e.type === 'tool' && e.state !== 'running');
    // The tool is not even offered to Kofi's assistant: Kofi does not manage meetings.
    expect(tool === undefined || tool.state === 'refused').toBe(true);
    expect((await get(t.kofi, '/assistant/drafts')).body.drafts).toEqual([]);
  });
});
