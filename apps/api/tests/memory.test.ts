import type { TestSchema } from '@kete/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 029: what a person asks her assistant to remember — hers only, shown to her, forgotten on
// demand, read by her assistant in every conversation.

let db: TestSchema;
const api = createApi();
const t = { kofi: '', esi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `memory-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
/** What the model was told, call after call. */
const systems: string[] = [];

beforeAll(async () => {
  db = await startApi();
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
});

afterAll(async () => {
  useModel(undefined);
  await db?.drop();
});

async function chat(token: string, message: string) {
  const response = await api.request('/v1/assistant/chat/stream', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Answer);
}

describe('the assistant’s memory', () => {
  let memoryId = '';

  it('keeps what she asks to remember, hers only, once', async () => {
    const kept = await call(t.kofi, 'POST', '/assistant/memories', {
      text: 'Vos rapports : en français, montants en FCFA.',
    });
    expect(kept).toMatchObject({ status: 201, body: { memory: { origin: 'person' } } });
    memoryId = (kept.body.memory as { memoryId: string }).memoryId;
    await call(t.kofi, 'POST', '/assistant/memories', {
      text: 'Vos rapports : en français, montants en FCFA.',
    });
    expect(
      ((await call(t.kofi, 'GET', '/assistant/memories')).body.memories as unknown[]).length,
    ).toBe(1);
    expect((await call(t.esi, 'GET', '/assistant/memories')).body).toEqual({ memories: [] });
    expect((await call(t.esi, 'POST', `/assistant/memories/${memoryId}/forget`, {})).status).toBe(
      404,
    );
  });

  it('is read by her assistant, and grows when she says « retiens que… »', async () => {
    let step = 0;
    useModel(
      new MockLanguageModelV4({
        doStream: async (options) => {
          step += 1;
          const sys = options.prompt.find((p) => p.role === 'system');
          systems.push(typeof sys?.content === 'string' ? sys.content : '');
          const chunks: object[] =
            step === 1
              ? [
                  { type: 'stream-start', warnings: [] },
                  {
                    type: 'tool-call',
                    toolCallId: 'm1',
                    toolName: 'memory_remember',
                    input: JSON.stringify({
                      text: 'Vous signez les achats au-delà de 1 000 000 FCFA.',
                    }),
                  },
                  {
                    type: 'finish',
                    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                    usage,
                  },
                ]
              : [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  { type: 'text-delta', id: 't1', delta: 'C’est retenu.' },
                  { type: 'text-end', id: 't1' },
                  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
                ];
          return { stream: simulateReadableStream({ chunks }) as never };
        },
      }),
    );
    const events = await chat(t.kofi, 'Retiens que je signe les achats au-delà de 1 000 000 FCFA.');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool', name: 'memory_remember', state: 'done' }),
    );
    expect(systems[0]).toContain('Vos rapports : en français, montants en FCFA.');
    const memories = (await call(t.kofi, 'GET', '/assistant/memories')).body.memories as {
      text: string;
      origin: string;
    }[];
    expect(memories).toContainEqual(
      expect.objectContaining({
        text: 'Vous signez les achats au-delà de 1 000 000 FCFA.',
        origin: 'assistant',
      }),
    );
  });

  it('forgets on demand', async () => {
    expect((await call(t.kofi, 'POST', `/assistant/memories/${memoryId}/forget`, {})).body).toEqual(
      { forgotten: true },
    );
    const left = (await call(t.kofi, 'GET', '/assistant/memories')).body.memories as {
      text: string;
    }[];
    expect(left.map((m) => m.text)).toEqual(['Vous signez les achats au-delà de 1 000 000 FCFA.']);
  });
});
