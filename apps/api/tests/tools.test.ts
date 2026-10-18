import { readJournal } from '@kete/commands';
import { inOrganization } from '@kete/tenancy';
import type { TestSchema } from '@kete/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApi } from '../src/app.js';
import { useCardReader } from '../src/features/registry/index.js';
import { reachable, useToolsFetch } from '../src/features/tools/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 093: KYA's own tools — its CRM described by OpenAPI, its ticketing served by an MCP server —
// imported by an administrator and given to its agents under Kete's rules: a read runs alone, an
// act is a draft she decides, a destruction waits for her confirmation. The key goes in once and
// never comes back; a set turned off leaves every agent at once.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '' };
let key = 0;
const KEY = 'crm-key-for-the-test';

/** What the CRM's API and the ticketing's server received. */
const seen = { crm: [] as string[], authorization: [] as string[], tickets: [] as string[] };

const description = {
  openapi: '3.1.0',
  info: { title: 'CRM', version: '1' },
  servers: [{ url: '/api' }],
  paths: {
    '/contacts': {
      get: { operationId: 'listContacts', summary: 'Les contacts' },
      post: {
        operationId: 'createContact',
        summary: 'Crée un contact',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    '/contacts/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      delete: { operationId: 'deleteContact', summary: 'Supprime un contact' },
    },
  },
};

async function crm(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/openapi.json') return Response.json(description);
  // A description whose one operation, prefixed « decisions », is named like Kete's own.
  if (url.pathname === '/clash.json') {
    return Response.json({
      openapi: '3.1.0',
      info: { title: 'Clash', version: '1' },
      servers: [{ url: 'https://crm.kya.test/api' }],
      paths: { '/inbox': { get: { operationId: 'inbox' } } },
    });
  }
  seen.crm.push(`${request.method} ${url.pathname}`);
  seen.authorization.push(request.headers.get('authorization') ?? '');
  if (request.method === 'POST') return Response.json({ id: 'c-2' }, { status: 201 });
  return Response.json([{ id: 'c-1', name: 'Phébé Mensah' }]);
}

/** The ticketing's MCP server, in memory: one tool that reads, one that writes. */
const tickets = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'tickets', version: '1' });
    server.registerTool(
      'search_tickets',
      {
        description: 'Cherche des tickets.',
        inputSchema: z.object({ q: z.string() }),
        annotations: { readOnlyHint: true },
      },
      async ({ q }) => {
        seen.tickets.push(`search ${q}`);
        return { content: [{ type: 'text', text: '[]' }], structuredContent: { tickets: [] } };
      },
    );
    server.registerTool(
      'close_ticket',
      { description: 'Ferme un ticket.', inputSchema: z.object({ id: z.string() }) },
      async () => {
        seen.tickets.push('close');
        return { content: [{ type: 'text', text: 'closed' }] };
      },
    );
    return server;
  },
  { responseMode: 'json' },
);

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `tools-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

/** A copilot connected through the gateway with the person's token. */
async function copilot(token: string): Promise<Client> {
  const client = new Client(
    { name: 'copilot-test', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://api.kete.test/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (url, init) => api.request(url.toString(), init),
    }),
  );
  return client;
}
const names = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name);
async function answer(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
  };
  return JSON.parse(result.content.find((c) => c.type === 'text')?.text ?? '{}') as Answer;
}

let crmSet = '';

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.KETE_ACCOUNT_URL = 'https://compte.kete.test';
  db = await startApi();
  useCardReader(async () => null);
  useToolsFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    const host = new URL(request.url).hostname;
    if (host === 'crm.kya.test') return crm(request);
    if (host === 'tickets.kya.test') return tickets.fetch(request);
    throw new Error(`unknown host ${host}`);
  }) as typeof fetch);
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
});

afterAll(async () => {
  useToolsFetch(undefined);
  await db?.drop();
});

describe('an administrator imports her organization’s tools', () => {
  it('reads an OpenAPI description once, each operation with how far an agent goes', async () => {
    const imported = await post(t.admin, '/tools', {
      kind: 'openapi',
      label: 'CRM',
      prefix: 'crm',
      address: 'https://crm.kya.test/openapi.json',
      secret: KEY,
    });
    expect(imported.status).toBe(201);
    const set = imported.body.set as Answer;
    crmSet = String(set.setId);
    expect(set).toMatchObject({ baseUrl: 'https://crm.kya.test/api', hasSecret: true });
    expect(JSON.stringify(imported.body)).not.toContain(KEY);
    expect((set.tools as Answer[]).map((tool) => [tool.name, tool.effect])).toEqual([
      ['crm_list_contacts', 'read'],
      ['crm_create_contact', 'act'],
      ['crm_delete_contact', 'destroy'],
    ]);
    // Its key never enters the journal.
    const [entry] = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'import-tools' }),
    );
    expect(JSON.stringify(entry)).not.toContain(KEY);
  });

  it('reads a remote MCP server’s tools, a tool not marked read-only as a destruction', async () => {
    const imported = await post(t.admin, '/tools', {
      kind: 'mcp',
      label: 'Tickets',
      prefix: 'tickets',
      address: 'https://tickets.kya.test/mcp',
    });
    expect(imported.status).toBe(201);
    expect(
      ((imported.body.set as Answer).tools as Answer[]).map((tool) => [tool.name, tool.effect]),
    ).toEqual([
      ['tickets_search_tickets', 'read'],
      ['tickets_close_ticket', 'destroy'],
    ]);
  });

  it('is refused to a member, a prefix twice, an address not in https, a private one', async () => {
    const set = {
      kind: 'mcp',
      label: 'X',
      prefix: 'other',
      address: 'https://tickets.kya.test/mcp',
    };
    expect((await post(t.awa, '/tools', set)).status).toBe(403);
    expect((await get(t.awa, '/tools')).status).toBe(403);
    expect((await post(t.admin, '/tools', { ...set, prefix: 'crm' })).body.error).toBe(
      'prefix_taken',
    );
    expect(
      (await post(t.admin, '/tools', { ...set, address: 'http://tickets.kya.test' })).status,
    ).toBe(422);
    // A Kete capability's name is never shadowed.
    const clash = await post(t.admin, '/tools', {
      kind: 'openapi',
      label: 'Clash',
      prefix: 'decisions',
      address: 'https://crm.kya.test/clash.json',
    });
    expect(clash.body.error).toBe('tool_name_taken');
    // Outside the tests, only the public internet.
    expect(await reachable('https://127.0.0.1/openapi.json')).toBe(false);
    expect(await reachable('https://localhost/mcp')).toBe(false);
    expect(await reachable('https://10.0.0.8/mcp')).toBe(false);
  });

  it('lists the sets, never their key', async () => {
    const listed = await get(t.admin, '/tools');
    expect((listed.body.sets as Answer[]).map((set) => set.label)).toEqual(['CRM', 'Tickets']);
    expect(JSON.stringify(listed.body)).not.toContain(KEY);
  });
});

describe('her agents use them under Kete’s rules', () => {
  it('reads alone, with the set’s key, through the gateway', async () => {
    const client = await copilot(t.admin);
    expect(await names(client)).toEqual(
      expect.arrayContaining(['crm_list_contacts', 'crm_create_contact', 'tickets_search_tickets']),
    );
    expect(await answer(client, 'crm_list_contacts', {})).toMatchObject({
      status: 'done',
      output: [{ id: 'c-1' }],
    });
    expect(await answer(client, 'tickets_search_tickets', { q: 'onduleur' })).toMatchObject({
      status: 'done',
    });
    expect(seen.crm).toEqual(['GET /api/contacts']);
    expect(seen.authorization).toEqual([`Bearer ${KEY}`]);
    expect(seen.tickets).toEqual(['search onduleur']);
    await client.close();
  });

  it('acts by a draft she decides: nothing reaches the tool before', async () => {
    const client = await copilot(t.admin);
    const prepared = await answer(client, 'crm_create_contact', { body: { name: 'Kofi Agbo' } });
    expect(prepared.status).toBe('draft');
    // Its destruction waits for her confirmation too.
    expect((await answer(client, 'tickets_close_ticket', { id: 'T-1' })).status).toBe('draft');
    await client.close();
    expect(seen.crm).toEqual(['GET /api/contacts']);
    expect(seen.tickets).not.toContain('close');
    const drafts = (await get(t.admin, '/assistant/drafts')).body.drafts as Answer[];
    const create = drafts.find((draft) => draft.capability === 'crm_create_contact');
    expect(create).toMatchObject({
      autonomy: 3,
      recordType: 'imported_tool_call.crm_create_contact',
    });
    const decided = await post(t.admin, `/assistant/drafts/${String(create?.draftId)}/decide`, {
      action: 'validate',
    });
    expect(decided.body.status).toBe('validated');
    expect(seen.crm).toEqual(['GET /api/contacts', 'POST /api/contacts']);
    const [entry] = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'crm-create-contact' }),
    );
    expect(entry).toMatchObject({ actor: { kind: 'person', id: 'usr_ama' } });
  });

  it('are not given to a person without the permission', async () => {
    const client = await copilot(t.awa);
    expect((await names(client)).some((name) => name.startsWith('crm_'))).toBe(false);
    await client.close();
  });

  it('leave every agent at once when the set is turned off', async () => {
    expect((await post(t.admin, `/tools/${crmSet}/status`, { status: 'off' })).status).toBe(200);
    const client = await copilot(t.admin);
    const offered = await names(client);
    expect(offered.some((name) => name.startsWith('crm_'))).toBe(false);
    expect(offered).toContain('tickets_search_tickets');
    await client.close();
  });
});
