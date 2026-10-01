import { readJournal } from '@kete/commands';
import { inOrganization } from '@kete/tenancy';
import type { TestSchema } from '@kete/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 006: a person's copilot reaches Kete Enterprise through one MCP address, sees only what she
// may see, acts as her agent within her rights, and every call is traced.

let db: TestSchema;
const api = createApi();
const t: Record<string, string> = {};
const ids: Record<string, string> = {};
let key = 0;

const post = async (token: string | undefined, path: string, body: object) =>
  (
    await api.request(`/v1${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token ?? ''}`,
        'content-type': 'application/json',
        'idempotency-key': `gateway-key-${++key}`,
      },
      body: JSON.stringify(body),
    })
  ).json() as Promise<Record<string, string>>;

/** A copilot connected with the person's token. */
async function copilot(token: string | undefined): Promise<Client> {
  const client = new Client({ name: 'copilot-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://api.kete.test/mcp'), {
    requestInit: {
      headers: { authorization: `Bearer ${token ?? ''}`, 'user-agent': 'copilot-test' },
    },
    fetch: async (url, init) => api.request(url.toString(), init),
  });
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  return client;
}

/** A tool's answer, as the copilot reads it. */
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';
  // A capability answers { status, output }.
  const answer = JSON.parse(text) as { output?: unknown };
  return { error: result.isError ?? false, value: answer.output };
}

beforeAll(async () => {
  process.env.KETE_ACCOUNT_URL = 'https://compte.kete.test';
  db = await startApi();
  useCardReader(async () => null);
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.awa = await tokenFor('usr_awa', { role: 'member', name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { role: 'member', name: 'Kofi' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' }))
    .unitTypeId;
  ids.group =
    (
      await post(t.admin, '/structure/units', {
        unitTypeId: type,
        name: 'KYA Group',
        startsOn: '2026-01-01',
      })
    ).unitId ?? '';
  ids.lome =
    (
      await post(t.admin, '/structure/units', {
        unitTypeId: type,
        name: 'Agence de Lomé',
        parentId: ids.group,
        startsOn: '2026-01-01',
      })
    ).unitId ?? '';
  const position = (
    await post(t.admin, '/structure/positions', {
      unitId: ids.lome,
      title: 'Commerciale',
      startsOn: '2026-01-01',
    })
  ).positionId;
  const awa = (
    await post(t.admin, '/structure/people', { name: 'Awa Mensah', accountUserId: 'usr_awa' })
  ).personId;
  await post(t.admin, '/structure/assignments', {
    personId: awa,
    positionId: position,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
});
afterAll(async () => {
  await db.drop();
});

describe('a person connects her copilot', () => {
  it('is told where to get a token, and gets nothing without one', async () => {
    const refused = await api.request('https://api.kete.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://api.kete.test/.well-known/oauth-protected-resource"',
    );
    const metadata = await (
      await api.request('https://api.kete.test/.well-known/oauth-protected-resource')
    ).json();
    expect(metadata).toMatchObject({
      resource: 'https://api.kete.test/mcp',
      authorization_servers: ['https://compte.kete.test'],
    });
  });

  it("lists the gateway's tools", async () => {
    const client = await copilot(t.awa);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'structure_chart',
        'registry_list',
        'registry_register',
        'decisions_inbox',
      ]),
    );
    await client.close();
  });
});

describe('the copilot acts for her, within her rights', () => {
  it('sees the structure as she sees it', async () => {
    const client = await copilot(t.awa);
    const chart = (await call(client, 'structure_chart')).value as {
      units: { name: string; positions: { holders: { name: string }[] }[] }[];
    };
    expect(chart.units.map((u) => u.name)).toEqual(['Agence de Lomé']);
    expect(chart.units[0]?.positions[0]?.holders[0]?.name).toBe('Awa Mensah');
    await client.close();
    const stranger = await copilot(t.kofi);
    expect(((await call(stranger, 'structure_chart')).value as { units: unknown[] }).units).toEqual(
      [],
    );
    await stranger.close();
  });

  it('registers in her own space, as her agent, in the journal', async () => {
    const client = await copilot(t.awa);
    const registered = await call(client, 'registry_register', {
      kind: 'skill',
      name: 'Relances clients',
    });
    expect(registered.error).toBe(false);
    const listed = (await call(client, 'registry_list')).value as {
      name: string;
      owner: string;
      tier: { kind: string };
    }[];
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'Relances clients',
        owner: 'Awa Mensah',
        tier: { kind: 'personal' },
      }),
    ]);
    await client.close();
    const [entry] = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'register-resource' }),
    );
    expect(entry).toMatchObject({
      actor: { kind: 'agent', id: 'agt_gateway' },
      onBehalfOf: { kind: 'person', id: 'usr_awa' },
      channel: 'mcp',
    });
    // Another person's copilot does not see it.
    const stranger = await copilot(t.kofi);
    expect((await call(stranger, 'registry_list')).value).toEqual([]);
    await stranger.close();
  });

  it('reads her Inbox, and decides nothing', async () => {
    const client = await copilot(t.awa);
    expect((await call(client, 'decisions_inbox')).value).toEqual({ toDecide: [], mine: [] });
    const { tools } = await client.listTools();
    expect(
      tools.some((tool) => /decide/.test(tool.name) && !tool.name.startsWith('kete_draft')),
    ).toBe(false);
    await client.close();
  });
});

describe('every call traced', () => {
  it('lets the person read her own calls', async () => {
    const response = await api.request('/v1/gateway/calls', {
      headers: { authorization: `Bearer ${t.awa}` },
    });
    const { calls } = (await response.json()) as { calls: { tool: string; client: string }[] };
    expect(calls.map((c) => c.tool)).toEqual(
      expect.arrayContaining([
        'structure_chart',
        'registry_register',
        'registry_list',
        'decisions_inbox',
      ]),
    );
    expect(calls[0]?.client).toBe('copilot-test');
    const other = await api.request('/v1/gateway/calls', {
      headers: { authorization: `Bearer ${t.admin}` },
    });
    expect(((await other.json()) as { calls: unknown[] }).calls).toEqual([]);
  });
});
