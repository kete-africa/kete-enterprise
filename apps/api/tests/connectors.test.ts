import type { TestSchema } from '@kete/testing';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApi } from '../src/app.js';
import { readConnected, useConnectorFetch } from '../src/features/connectors/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 069: a business tool the organization already has is read through its MCP server. What
// waits there for a person lands in her « Décider », and leaves it once decided in the tool. A
// connector is tried before it is connected, calls the one tool it was given — never one that
// writes — and its credential goes in once and never comes back.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
let key = 0;
let connectorId = '';
const SECRET = 'frappe-key-for-the-test';

/** The purchase requests waiting in the ERP, as its server lists them. */
let pending = [
  { name: 'MAT-MR-2026-00041', title: 'Huit batteries 200 Ah', approver: 'awa@kya.test' },
  { name: 'MAT-MR-2026-00042', title: 'Câbles solaires 6 mm²', approver: 'AWA@kya.test' },
  { name: 'MAT-MR-2026-00043', title: 'Onduleur 5 kVA', approver: 'inconnu@ailleurs.test' },
];
/** What the ERP's server received: its credential, and each tool called. */
const seen = { authorization: [] as string[], tools: [] as string[] };

/** An ERP's MCP server, in memory: one tool that lists, one that writes. */
const erp = createMcpHandler(
  () => {
    const server = new McpServer({ name: 'erp', version: '1' });
    server.registerTool(
      'list_documents',
      {
        description: 'Lists documents of a doctype.',
        inputSchema: z.object({ doctype: z.string() }).loose(),
        annotations: { readOnlyHint: true },
      },
      async ({ doctype }) => {
        seen.tools.push(`list_documents:${doctype}`);
        return {
          content: [{ type: 'text', text: JSON.stringify(pending) }],
          structuredContent: { data: pending },
        };
      },
    );
    server.registerTool(
      'update_document',
      {
        description: 'Updates a document.',
        inputSchema: z.object({}).loose(),
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async () => {
        seen.tools.push('update_document');
        return { content: [{ type: 'text', text: '[]' }] };
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
      'idempotency-key': `connectors-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const todoOf = async (token: string) =>
  (
    (await get(token, '/workspace/tasks')).body.tasks as {
      source: string;
      title: string;
      href: string;
    }[]
  ).filter((task) => task.source === 'ERP');

const reading = {
  tool: 'list_documents',
  arguments: { doctype: 'Material Request', filters: { workflow_state: 'Pending' } },
  label: 'Demande d’achat',
  fields: { key: 'name', title: 'title', person: 'approver' },
  link: 'https://erp.kya.test/app/material-request/{key}',
};
const connector = { name: 'ERP', address: 'https://erp-mcp.kya.test', secret: SECRET, reading };

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
  db = await startApi();
  useConnectorFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    seen.authorization.push(request.headers.get('authorization') ?? '');
    return erp.fetch(request);
  }) as typeof fetch);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Achats',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  for (const [name, account, email] of [
    ['Awa Mensah', 'usr_awa', 'awa@kya.test'],
    ['Kofi Agbo', 'usr_kofi', 'kofi@kya.test'],
  ]) {
    const positionId = (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title: name,
        startsOn: '2026-01-01',
      })
    ).body.positionId;
    const personId = (
      await post(t.admin, '/structure/people', { name, accountUserId: account, email })
    ).body.personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  }
});

afterAll(async () => {
  useConnectorFetch(undefined);
  await db?.drop();
});

describe('a purchase request made in the ERP lands in Décider', () => {
  it('is added by an administrator, its credential kept and never returned', async () => {
    expect((await post(t.awa, '/connectors', connector)).status).toBe(403);
    expect((await get(t.awa, '/connectors')).status).toBe(403);
    expect(
      (await post(t.admin, '/connectors', { ...connector, address: 'http://erp.kya.test' })).status,
    ).toBe(422);
    const created = await post(t.admin, '/connectors', connector);
    expect(created).toMatchObject({
      status: 201,
      body: { connector: { name: 'ERP', status: 'trial', hasSecret: true } },
    });
    connectorId = (created.body.connector as { connectorId: string }).connectorId;
    expect((await post(t.admin, '/connectors', connector)).body).toMatchObject({
      error: 'name_taken',
    });
    // Neither the list, nor the table in clear, nor the journal holds it.
    const listed = await get(t.admin, '/connectors');
    expect(JSON.stringify(listed.body)).not.toContain(SECRET);
    expect(listed.body.presets).toMatchObject([{ key: 'frappe_purchase_requests' }]);
    const { rows } = await db.owner.query<{ kept: string }>(
      `select (select secret_sealed from ${db.schema}.connectors) || ' ' ||
              (select coalesce(string_agg(c::text, ' '), '') from ${db.schema}.kete_commands c) as kept`,
    );
    expect(rows[0]?.kept).not.toContain(SECRET);
    expect(rows[0]?.kept).toContain('v1.');
  });

  it('is tried before it is connected: the trial says what it would file, and files nothing', async () => {
    const on = { status: 'connected' };
    expect((await post(t.admin, `/connectors/${connectorId}/status`, on)).body).toMatchObject({
      error: 'not_tried',
    });
    const tried = await post(t.admin, `/connectors/${connectorId}/try`);
    expect(tried.body.report).toEqual({
      found: 3,
      filed: [
        { key: 'MAT-MR-2026-00041', title: 'Huit batteries 200 Ah', person: 'Awa Mensah' },
        { key: 'MAT-MR-2026-00042', title: 'Câbles solaires 6 mm²', person: 'Awa Mensah' },
      ],
      unmatched: [{ key: 'MAT-MR-2026-00043', email: 'inconnu@ailleurs.test' }],
      closed: 0,
    });
    expect(await todoOf(t.awa)).toEqual([]);
    // It carried its credential, and called the one tool it was given.
    expect(seen.authorization.every((value) => value === `Bearer ${SECRET}`)).toBe(true);
    expect(seen.tools).toEqual(['list_documents:Material Request']);
    expect((await post(t.admin, `/connectors/${connectorId}/read`)).body).toMatchObject({
      error: 'not_connected',
    });
    expect((await post(t.admin, `/connectors/${connectorId}/status`, on)).body).toMatchObject({
      status: 'connected',
    });
  });

  it('files what waits for her in her « Décider », with its way back to the tool', async () => {
    // The worker's round reads every connected connector.
    expect(await readConnected(db.app, transaction)).toBe(1);
    const todo = await todoOf(t.awa);
    expect(todo.map((task) => task.title).sort()).toEqual([
      'Demande d’achat MAT-MR-2026-00041 : Huit batteries 200 Ah',
      'Demande d’achat MAT-MR-2026-00042 : Câbles solaires 6 mm²',
    ]);
    expect(todo.map((task) => task.href)).toContain(
      'https://erp.kya.test/app/material-request/MAT-MR-2026-00041',
    );
    // Hers only: a colleague sees none of it.
    expect(await todoOf(t.kofi)).toEqual([]);
    // « Apps » says what the center receives from it — to her, what waits for her (spec 070).
    const behind = (await get(t.awa, '/apps')).body.apps as {
      kind: string;
      name: string | null;
      receives: { waiting: number; reads: string | null };
    }[];
    expect(behind.filter((entry) => entry.kind === 'connector')).toMatchObject([
      { name: 'ERP', receives: { waiting: 2, reads: 'Demande d’achat' } },
    ]);
    const his = (await get(t.kofi, '/apps')).body.apps as typeof behind;
    expect(his.find((entry) => entry.kind === 'connector')?.receives.waiting).toBe(0);
    // Its address and its credential stay with the administrators.
    expect(JSON.stringify(behind)).not.toContain('erp-mcp.kya.test');
    // Read again, nothing doubles.
    await post(t.admin, `/connectors/${connectorId}/read`);
    expect(await todoOf(t.awa)).toHaveLength(2);
  });

  it('takes out of her « Décider » what was decided in the tool', async () => {
    pending = pending.filter((request) => request.name !== 'MAT-MR-2026-00041');
    const read = await post(t.admin, `/connectors/${connectorId}/read`);
    expect(read.body.report).toMatchObject({ found: 2, closed: 1 });
    expect((await todoOf(t.awa)).map((task) => task.title)).toEqual([
      'Demande d’achat MAT-MR-2026-00042 : Câbles solaires 6 mm²',
    ]);
  });

  it('never calls a tool its server says writes, and keeps why a reading failed', async () => {
    const writer = await post(t.admin, '/connectors', {
      ...connector,
      name: 'ERP écriture',
      reading: { ...reading, tool: 'update_document' },
    });
    const writerId = (writer.body.connector as { connectorId: string }).connectorId;
    expect((await post(t.admin, `/connectors/${writerId}/try`)).body).toMatchObject({
      error: 'not_read_only',
    });
    const missing = await post(t.admin, '/connectors', {
      ...connector,
      name: 'ERP ailleurs',
      reading: { ...reading, tool: 'get_documents' },
    });
    const missingId = (missing.body.connector as { connectorId: string }).connectorId;
    expect((await post(t.admin, `/connectors/${missingId}/try`)).body).toMatchObject({
      error: 'no_such_tool',
    });
    // Never tried with success, it cannot be connected; and the writing tool was never called.
    expect(
      (await post(t.admin, `/connectors/${writerId}/status`, { status: 'connected' })).body,
    ).toMatchObject({ error: 'not_tried' });
    expect(seen.tools).not.toContain('update_document');
    const listed = (await get(t.admin, '/connectors')).body.connectors as {
      name: string;
      lastError: string | null;
    }[];
    expect(listed.find((entry) => entry.name === 'ERP écriture')?.lastError).toBe('not_read_only');
    expect(listed.find((entry) => entry.name === 'ERP')?.lastError).toBeNull();
  });

  it('stops reading once switched off', async () => {
    await post(t.admin, `/connectors/${connectorId}/status`, { status: 'off' });
    expect(await readConnected(db.app, transaction)).toBe(0);
  });
});
