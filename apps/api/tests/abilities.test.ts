import type { SpeechPort, WebSearchPort } from '@kete/ai';
import { memoryProvider } from '@kete/sandbox';
import { createAccountSettings } from '@kete/settings';
import type { TestSchema } from '@kete/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useSandboxProvider, useSpeech, useWeb } from '../src/features/ai/index.js';
import { runTask, useTaskModel } from '../src/features/agents/index.js';
import { useModel } from '../src/features/assistant/index.js';
import { useCardReader } from '../src/features/registry/index.js';
import { useAccountSettings } from '../src/features/settings/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 094: what the organization's agents do beyond Kete — the web, a computer of their own, an
// answer said aloud. Nothing is on until the organization says so in « Réglages »; each ability is
// a tool under its policies; once a page was read, nothing acts at once in that turn.

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
      'idempotency-key': `abilities-key-${++key}`,
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
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Answer);
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
type Step = { tool: string; input: object } | { text: string };

/** A streamed model that plays its steps in order, and notes the tools it was offered. */
function playing(...steps: Step[]) {
  let at = 0;
  const offered: string[][] = [];
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      offered.push((options.tools ?? []).map((tool) => tool.name));
      const step = steps[Math.min(at, steps.length - 1)] as Step;
      at += 1;
      const chunks: object[] =
        'tool' in step
          ? [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: `call_${at}`,
                toolName: step.tool,
                input: JSON.stringify(step.input),
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
                usage,
              },
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: step.text },
              { type: 'text-end', id: 't' },
              { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
            ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
  return { model, offered };
}

const page =
  '<html><head><title>Tarifs</title></head><body><p>Le kWh coûte 98 F.</p></body></html>';
const fetched: string[] = [];
const searched: string[] = [];
const said: string[] = [];
const compte = { person: {} as Record<string, unknown> };
const sandboxes = memoryProvider((command) =>
  command === 'echo bonjour' ? { stdout: 'bonjour\n' } : undefined,
);

const search: WebSearchPort = {
  search: (query) => {
    searched.push(query);
    return Promise.resolve({ summary: 'Fixé par l’ARSE.', sources: [] });
  },
};
const voice: SpeechPort = {
  speak: (text) => {
    said.push(text);
    return Promise.resolve({ audio: new Uint8Array([73, 68, 51]), mediaType: 'audio/mpeg' });
  },
};

const beyond = ['web_search', 'web_read', 'computer_run', 'computer_write', 'computer_read'];

beforeAll(async () => {
  useAccountSettings(
    createAccountSettings({
      url: 'https://compte.kete.test',
      fetch: (async () =>
        Response.json({
          organizationId: 'org_kya',
          organization: {},
          person: compte.person,
        })) as unknown as typeof fetch,
    }),
  );
  db = await startApi();
  useCardReader(async () => null);
  useWeb({
    search,
    fetch: (async (url: string | URL | Request) => {
      fetched.push(String(url));
      return new Response(page, { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch,
  });
  useSpeech(voice);
  useSandboxProvider(sandboxes);
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
});

afterAll(async () => {
  useModel(undefined);
  useTaskModel(undefined);
  useWeb(undefined);
  useSpeech(undefined);
  useSandboxProvider(undefined);
  await db?.drop();
});

describe('the organization decides', () => {
  it('gives its agents nothing beyond Kete until it says so', async () => {
    const { model, offered } = playing({ text: 'Bonjour.' });
    useModel(model);
    await chat(t.kofi, { message: 'Bonjour' });
    expect(offered[0]?.some((name) => beyond.includes(name))).toBe(false);
  });

  it('turns the web and a computer on in « Réglages », an administrator only', async () => {
    const change = { key: 'kete.agent_abilities', layer: 'app', value: ['web', 'computer'] };
    expect((await post(t.kofi, '/settings', change)).status).toBe(403);
    expect((await post(t.admin, '/settings', change)).status).toBe(200);
    const { model, offered } = playing({ text: 'Bonjour.' });
    useModel(model);
    await chat(t.kofi, { message: 'Bonjour' });
    expect(offered[0]).toEqual(expect.arrayContaining(beyond));
  });
});

describe('her assistant beyond Kete', () => {
  it('searches and reads the web, and then acts at once on nothing', async () => {
    const { model } = playing(
      { tool: 'web_search', input: { query: 'tarif kWh Togo' } },
      { tool: 'web_read', input: { url: 'https://arse.tg/tarifs' } },
      { tool: 'registry_register', input: { kind: 'skill', name: 'Tarifs ARSE' } },
      { text: 'Le kWh coûte 98 F.' },
    );
    useModel(model);
    const events = await chat(t.kofi, { message: 'Quel est le prix du kWh ?' });
    expect(searched).toEqual(['tarif kWh Togo']);
    expect(fetched).toEqual(['https://arse.tg/tarifs']);
    // Registering lands at once (level 2): after a page was read, it waits for her.
    const resources = (await get(t.kofi, '/registry')).body.resources as Answer[];
    expect(resources.some((resource) => resource.name === 'Tarifs ARSE')).toBe(false);
    expect(events.filter((event) => event.type === 'tool').map((event) => event.name)).toEqual(
      expect.arrayContaining(['web_search', 'web_read', 'registry_register']),
    );
    // The same gesture in a turn that read nothing from outside lands at once.
    useModel(
      playing(
        { tool: 'registry_register', input: { kind: 'skill', name: 'Tarifs ARSE' } },
        { text: 'Enregistré.' },
      ).model,
    );
    await chat(t.kofi, { message: 'Enregistre la compétence Tarifs ARSE' });
    const after = (await get(t.kofi, '/registry')).body.resources as Answer[];
    expect(after.some((resource) => resource.name === 'Tarifs ARSE')).toBe(true);
  });

  it('works on one computer for the whole conversation', async () => {
    useModel(
      playing({ tool: 'computer_run', input: { command: 'echo bonjour' } }, { text: 'Fait.' })
        .model,
    );
    const first = await chat(t.kofi, { message: 'Dis bonjour sur ton ordinateur' });
    const conversationId = String(
      first.find((event) => event.type === 'conversation')?.conversationId,
    );
    useModel(
      playing({ tool: 'computer_run', input: { command: 'echo bonjour' } }, { text: 'Fait.' })
        .model,
    );
    await chat(t.kofi, { message: 'Encore', conversationId });
    expect(sandboxes.sandboxes).toHaveLength(1);
    expect(sandboxes.sandboxes[0]?.commands).toEqual(['echo bonjour', 'echo bonjour']);
  });
});

describe('an agent at work', () => {
  it('is given the web, a computer of the task’s own, and a researcher to hand a question to', async () => {
    await post(t.admin, '/structure/people', { name: 'Kofi', accountUserId: 'usr_kofi' });
    const agentId = String(
      (
        await post(t.kofi, '/agents', {
          name: 'Agent de veille',
          kind: 'personal',
          mission: 'Suivre les tarifs de l’énergie.',
          watches: ['decisions'],
        })
      ).body.agentId,
    );
    const taskId = String(
      (
        (await post(t.kofi, `/agents/${agentId}/tasks`, { instruction: 'Le tarif du kWh ?' })).body
          .task as Answer
      ).taskId,
    );
    const offered: string[][] = [];
    useTaskModel(
      new MockLanguageModelV4({
        doGenerate: (options) => {
          offered.push((options.tools ?? []).map((tool) => tool.name));
          return Promise.resolve({
            content: [{ type: 'text', text: 'Rien de neuf.' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage,
            warnings: [],
          });
        },
      }),
    );
    expect(await runTask('org_kya', taskId)).toBe('done');
    expect(offered[0]).toEqual(expect.arrayContaining([...beyond, 'delegate_researcher']));
  });
});

describe('an answer said aloud', () => {
  it('is said by the instance’s voice, and read as it finishes when she chose so', async () => {
    const response = await api.request('/v1/assistant/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${t.kofi}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Le kWh coûte 98 F.', language: 'fr' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
    expect(said).toEqual(['Le kWh coûte 98 F.']);
    expect((await get(t.kofi, '/assistant')).body).toMatchObject({
      speech: true,
      readAloud: false,
    });
    compte.person = { 'kete.spoken_answers': true };
    // A session read again (the Compte Kete's layers are kept a few seconds per token).
    const again = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
    expect((await get(again, '/assistant')).body).toMatchObject({ readAloud: true });
  });

  it('is refused where the instance has no voice', async () => {
    useSpeech(null);
    expect((await post(t.kofi, '/assistant/speech', { text: 'Bonjour' })).body.error).toBe(
      'speech_off',
    );
    useSpeech(voice);
  });
});
