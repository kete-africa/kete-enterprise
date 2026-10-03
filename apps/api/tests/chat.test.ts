import type { TestSchema } from '@kete/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 027: the chat of the current era — files attached and read, commands and mentions picked in
// the composer, a document written in the side canvas, all kept with the conversation.

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
      'idempotency-key': `chat-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

async function stream(token: string, body: object) {
  const response = await api.request('/v1/assistant/chat/stream', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Answer);
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** What the model was given, and a model that writes in the canvas, then says a sentence. */
const seen: unknown[] = [];
function canvasModel() {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      step += 1;
      seen.push(options.prompt);
      const chunks: object[] =
        step === 1
          ? [
              { type: 'stream-start' as const, warnings: [] },
              {
                type: 'tool-call' as const,
                toolCallId: 'call_1',
                toolName: 'canvas_write',
                input: JSON.stringify({
                  title: 'Lettre au client',
                  content: '# Madame,\n\nVotre onduleur est réparé.',
                }),
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
              { type: 'text-delta' as const, id: 't1', delta: 'La lettre est dans le canevas.' },
              { type: 'text-end' as const, id: 't1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage,
              },
            ];
      return { stream: simulateReadableStream({ chunks }) as never };
    },
  });
}

beforeAll(async () => {
  db = await startApi();
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi' });
});

afterAll(async () => {
  useModel(undefined);
  await db?.drop();
});

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('the chat of the current era', () => {
  let attachmentId = '';

  it('reads a file attached, and refuses one it cannot read', async () => {
    const attached = await call(t.kofi, 'POST', '/assistant/attachments', {
      name: 'rapport.txt',
      contentType: 'text/plain',
      data: base64('Onduleur en panne chez le client de Agoè depuis lundi.'),
    });
    expect(attached).toMatchObject({ status: 201, body: { name: 'rapport.txt', kind: 'text' } });
    attachmentId = attached.body.attachmentId as string;
    const refused = await call(t.kofi, 'POST', '/assistant/attachments', {
      name: 'archive.zip',
      contentType: 'application/zip',
      data: base64('PK'),
    });
    expect(refused).toMatchObject({ status: 422, body: { error: 'unsupported_file' } });
  });

  it('sends the file, the command and the words to the model, and writes in the canvas', async () => {
    useModel(canvasModel());
    const events = await stream(t.kofi, {
      message: ':command[Rédiger]{name=write} une lettre au client',
      attachments: [attachmentId],
    });
    expect(events).toContainEqual({
      type: 'canvas',
      title: 'Lettre au client',
      content: '# Madame,\n\nVotre onduleur est réparé.',
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
    const prompt = JSON.stringify(seen[0]);
    expect(prompt).toContain('une lettre au client');
    expect(prompt).toContain('Onduleur en panne chez le client de Agoè');
    expect(prompt).toContain('canvas_write');
    expect(prompt).not.toContain(':command[');
    // Kept with the conversation: the file with her message, the document with the answer.
    const conversationId = events.find((e) => e.type === 'conversation')?.conversationId as string;
    const kept = (await call(t.kofi, 'GET', `/assistant/conversations/${conversationId}`)).body;
    const messages = kept.messages as Answer[];
    expect(messages[0]?.attachments).toEqual([
      expect.objectContaining({ attachmentId, name: 'rapport.txt' }),
    ]);
    expect(messages[1]?.canvas).toEqual({
      title: 'Lettre au client',
      content: '# Madame,\n\nVotre onduleur est réparé.',
    });
  });

  it('never lets another person send a file that is not hers', async () => {
    useModel(canvasModel());
    seen.length = 0;
    await stream(t.esi, { message: 'Que dit ce fichier ?', attachments: [attachmentId] });
    expect(JSON.stringify(seen[0])).not.toContain('Onduleur en panne');
  });
});
