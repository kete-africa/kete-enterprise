import { signWebhook } from '@kete/connections';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader } from '../src/features/registry/index.js';
import { useToolsFetch } from '../src/features/tools/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 105 (kete-core spec 147, ADR 0019; doctrine D-062, R8, R17): one connection, three uses. An
// organization's tool is seen once with what it serves — read at connection, act only tool by tool
// and never alone, signal by choice — and its health; its events arrive by a webhook signed with
// its own secret, kept once on the event path with the object they name.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '' };
let key = 0;
let crm = '';

const description = {
  openapi: '3.1.0',
  info: { title: 'CRM', version: '1' },
  servers: [{ url: '/api' }],
  paths: {
    '/invoices': {
      get: { operationId: 'listInvoices', summary: 'Les factures' },
      post: { operationId: 'sendInvoice', summary: 'Envoie une facture' },
    },
  },
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `connections-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
async function hook(id: string, body: string, signature: string | null) {
  const response = await api.request(`/public/connections/${id}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'kete-signature': signature } : {}),
    },
    body,
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

type View = {
  connectionId: string;
  uses: { read: boolean; act: { tool: string; level: number | null }[]; signal: string[] };
  health: string;
  webhook: boolean;
};

beforeAll(async () => {
  process.env.KETE_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64');
  db = await startApi();
  useCardReader(async () => null);
  useToolsFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const request = new Request(url, init);
    if (new URL(request.url).pathname === '/openapi.json') return Response.json(description);
    return Response.json([]);
  }) as typeof fetch);
  t.admin = await tokenFor('usr_ama', { role: 'admin', name: 'Ama' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  const imported = await call(t.admin, 'POST', '/tools', {
    kind: 'openapi',
    label: 'CRM',
    prefix: 'crm',
    address: 'https://crm.kya.test/openapi.json',
  });
  expect(imported.status).toBe(201);
  crm = String((imported.body.set as Answer).setId);
});

afterAll(async () => {
  useToolsFetch(undefined);
  await db?.drop();
});

describe('a connection, seen once with its three uses (FR-001, FR-002)', () => {
  it('reads when connected and acts nowhere until granted; an administrator’s only', async () => {
    expect((await call(t.awa, 'GET', '/connections')).status).toBe(403);
    const [connection] = (await call(t.admin, 'GET', '/connections')).body.connections as View[];
    expect(connection).toMatchObject({
      connectionId: crm,
      uses: { read: true, act: [{ tool: 'crm_send_invoice', level: null }], signal: [] },
      health: 'ok',
      webhook: false,
    });
  });

  it('acts tool by tool at a level, never alone; an unknown tool is refused', async () => {
    const grant = (act: object) =>
      call(t.admin, 'POST', `/connections/${crm}/grants`, { read: true, act });
    expect((await grant({ crm_list_invoices: 3 })).status).toBe(422);
    expect((await grant({ crm_send_invoice: 4 })).status).toBe(422);
    const granted = await grant({ crm_send_invoice: 3 });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({
      before: { act: {} },
      grants: { act: { crm_send_invoice: 3 } },
    });
    const [connection] = (await call(t.admin, 'GET', '/connections')).body.connections as View[];
    expect(connection?.uses.act).toEqual([
      expect.objectContaining({ tool: 'crm_send_invoice', level: 3 }),
    ]);
  });
});

describe('its events, by a signed webhook (FR-003, FR-004)', () => {
  let secret = '';
  const event = (id: string) =>
    JSON.stringify({
      id,
      type: 'invoice.overdue',
      description: 'Facture échue',
      object: { kind: 'invoice', id: 'F-2026-0004' },
      data: { days: 5 },
    });

  it('opens with a secret said once, never journaled', async () => {
    const opened = await call(t.admin, 'POST', `/connections/${crm}/webhook`);
    expect(opened.status).toBe(201);
    secret = String(opened.body.secret);
    expect(secret.length).toBeGreaterThan(30);
    const { rows } = await db.owner.query<{ input: unknown; output: unknown }>(
      `select input, output from ${db.schema}.kete_commands where name = 'open-connection-webhook'`,
    );
    expect(JSON.stringify(rows)).not.toContain(secret);
    const [connection] = (await call(t.admin, 'GET', '/connections')).body.connections as View[];
    expect(connection?.webhook).toBe(true);
  });

  it('keeps a signed event once, with its object; refuses one unsigned or signed by another', async () => {
    const body = event('evt-1');
    expect((await hook(crm, body, null)).status).toBe(401);
    expect((await hook(crm, body, signWebhook('another-secret', body))).status).toBe(401);
    expect((await hook('tls_00000000-0000', body, signWebhook(secret, body))).status).toBe(401);
    expect((await hook(crm, body, signWebhook(secret, body))).body).toEqual({
      outcome: 'accepted',
    });
    expect((await hook(crm, body, signWebhook(secret, body))).body).toEqual({
      outcome: 'duplicate',
    });
    const { rows } = await db.owner.query(
      `select source, product, type, object_kind, object_id, label from ${db.schema}.kete_events
        where source = 'connection'`,
    );
    expect(rows).toEqual([
      {
        source: 'connection',
        product: `connection:${crm}`,
        type: 'invoice.overdue',
        object_kind: 'invoice',
        object_id: 'F-2026-0004',
        label: 'Facture échue',
      },
    ]);
  });
});
