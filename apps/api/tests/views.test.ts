import type { TestSchema } from '@kete/testing';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApi } from '../src/app.js';
import { useModel } from '../src/features/assistant/index.js';
import { appToolsFor, useAppFetch } from '../src/features/gateway/index.js';
import { useCardReader } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 030: the team's apps' views in the chat (MCP Apps). The host shows a tool's view with its
// result, relays the view's calls with the person's own token, and never lets the model call a
// tool meant for the view alone.

let db: TestSchema;
const api = createApi();
const t = { kofi: '' };
let key = 0;
let resourceId = '';
/** The tokens the app received, in order. */
const seen: string[] = [];

/** An app served in memory (MCP 2026-07-28 and 2025): one tool with its view, one for the view only. */
const supportServer = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'support', version: '1' });
    server.registerResource(
      'table',
      'ui://kete/table',
      { mimeType: 'text/html;profile=mcp-app' },
      async () => ({
        contents: [
          { uri: 'ui://kete/table', mimeType: 'text/html;profile=mcp-app', text: '<p>table</p>' },
        ],
      }),
    );
    server.registerTool(
      'tickets_open',
      {
        description: 'The open tickets.',
        inputSchema: z.object({}),
        _meta: { ui: { resourceUri: 'ui://kete/table' } },
      },
      async () => ({
        content: [{ type: 'text', text: '{}' }],
        structuredContent: { title: 'Tickets', rows: [{ id: 'T-1', subject: 'Onduleur' }] },
      }),
    );
    server.registerTool(
      'kete_draft_validate',
      {
        description: 'The person validates the draft.',
        inputSchema: z.object({ draftId: z.string() }),
        _meta: { ui: { resourceUri: 'ui://kete/review', visibility: ['app'] } },
      },
      async ({ draftId }) => ({
        content: [{ type: 'text', text: '{}' }],
        structuredContent: { status: 'validated', draftId },
      }),
    );
    return server;
  },
  { responseMode: 'json' },
);

async function supportApp(request: Request): Promise<Response> {
  seen.push(request.headers.get('authorization') ?? '');
  return supportServer.fetch(request);
}

async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `views-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

beforeAll(async () => {
  db = await startApi();
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  useCardReader(async () => null);
  useAppFetch((async (url: string | URL | Request, init?: RequestInit) =>
    supportApp(new Request(url, init))) as typeof fetch);
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  const registered = await call(t.kofi, 'POST', '/registry/resources', {
    kind: 'app',
    name: 'Support',
    address: 'https://support.example.test',
  });
  resourceId = registered.body.resourceId as string;
});

afterAll(async () => {
  useAppFetch(undefined);
  useModel(undefined);
  await db?.drop();
});

describe('the apps’ views in the chat', () => {
  it('gives the model the app’s tools, never one meant for the view alone', async () => {
    const apps = await appToolsFor(
      { userId: 'usr_kofi', role: 'member', organizationId: 'org_kya' },
      t.kofi,
    );
    expect(apps.tools.map((x) => x.name)).toEqual(['support__tickets_open']);
    expect(apps.viewOf('support__tickets_open')).toEqual({ resourceId, uri: 'ui://kete/table' });
    await apps.close();
  });

  it('shows a tool’s view with its result, and keeps it with the answer', async () => {
    let step = 0;
    useModel(
      new MockLanguageModelV4({
        doStream: async () => {
          step += 1;
          const chunks: object[] =
            step === 1
              ? [
                  { type: 'stream-start', warnings: [] },
                  {
                    type: 'tool-call',
                    toolCallId: 'call_1',
                    toolName: 'support__tickets_open',
                    input: '{}',
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
                  { type: 'text-delta', id: 't1', delta: 'Voici les tickets ouverts.' },
                  { type: 'text-end', id: 't1' },
                  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
                ];
          return { stream: simulateReadableStream({ chunks }) as never };
        },
      }),
    );
    const response = await api.request('/v1/assistant/chat/stream', {
      method: 'POST',
      headers: { authorization: `Bearer ${t.kofi}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Les tickets ouverts ?' }),
    });
    const events = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const view = {
      tool: 'support__tickets_open',
      resource: resourceId,
      uri: 'ui://kete/table',
      input: {},
      result: { title: 'Tickets', rows: [{ id: 'T-1', subject: 'Onduleur' }] },
    };
    expect(events).toContainEqual({ type: 'view', ...view });
    const conversationId = events.find((e) => e.type === 'conversation')?.conversationId;
    const kept = await call(t.kofi, 'GET', `/assistant/conversations/${String(conversationId)}`);
    const messages = kept.body.messages as { views: unknown[] }[];
    expect(messages.at(-1)?.views).toEqual([view]);
  });

  it('reads a view’s page and relays its calls with her own token', async () => {
    const page = await call(
      t.kofi,
      'GET',
      `/views?resource=${resourceId}&uri=${encodeURIComponent('ui://kete/table')}`,
    );
    expect(page).toEqual({ status: 200, body: { html: '<p>table</p>' } });
    seen.length = 0;
    const decided = await call(t.kofi, 'POST', '/views/call', {
      resource: resourceId,
      name: 'kete_draft_validate',
      arguments: { draftId: 'drf_1' },
    });
    expect(decided.status).toBe(201);
    expect(decided.body.structuredContent).toEqual({ status: 'validated', draftId: 'drf_1' });
    expect(seen.every((h) => h === `Bearer ${t.kofi}`)).toBe(true);
    // Not her app: nothing.
    expect(
      (
        await call(
          t.kofi,
          'GET',
          `/views?resource=res_other&uri=${encodeURIComponent('ui://kete/table')}`,
        )
      ).status,
    ).toBe(404);
  });

  it('serves the sandbox for the views, on its own origin, requesting nothing', async () => {
    const response = await api.request('/views/sandbox');
    expect(response.status).toBe(200);
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain('frame-ancestors https://enterprise.kete.test');
    expect(await response.text()).toContain('ui/notifications/sandbox-proxy-ready');
  });
});
