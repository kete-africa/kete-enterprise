import { readJournal } from '@kete/commands';
import { inOrganization } from '@kete/tenancy';
import { assertOrganizationIsolation, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { dueAgents, wakeDueAgents } from '../src/features/agents/index.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 007: an agent with a job description sleeps, wakes, reads what its person may see within
// its own permissions and scope, signals what is wrong once, and closes what is solved.

let db: TestSchema;
const api = createApi();
const t: Record<string, string> = {};
const ids: Record<string, string> = {};
const cards: Record<string, IdentityCard | null> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(
  token: string | undefined,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token ?? ''}`,
      'content-type': 'application/json',
      'idempotency-key': `agents-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string | undefined, path: string, body: object = {}) =>
  call(token, 'POST', path, body);
const id = async (token: string | undefined, path: string, body: object, field: string) =>
  String((await post(token, path, body)).body[field] ?? '');

interface AgentView {
  agentId: string;
  name: string;
  actsFor: string | null;
  signals: { signalId: string; kind: string; subject: string }[];
}
const agentsOf = async (token: string | undefined) =>
  ((await call(token, 'GET', '/agents')).body as unknown as { agents: AgentView[] }).agents;

beforeAll(async () => {
  db = await startApi();
  useCardReader(async (address) => cards[address] ?? null);
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  for (const who of ['awa', 'kofi', 'yaw'])
    t[who] = await tokenFor(`usr_${who}`, { role: 'member', name: who });
  const type = await id(
    t.admin,
    '/structure/unit-types',
    { key: 'unit', name: 'Unité' },
    'unitTypeId',
  );
  ids.group = await id(
    t.admin,
    '/structure/units',
    { unitTypeId: type, name: 'KYA Group', startsOn: '2026-01-01' },
    'unitId',
  );
  ids.lome = await id(
    t.admin,
    '/structure/units',
    { unitTypeId: type, name: 'Agence de Lomé', parentId: ids.group, startsOn: '2026-01-01' },
    'unitId',
  );
  ids.head = await id(
    t.admin,
    '/structure/positions',
    { unitId: ids.lome, title: "Chef d'agence", startsOn: '2026-01-01' },
    'positionId',
  );
  ids.agent = await id(
    t.admin,
    '/structure/positions',
    { unitId: ids.lome, title: 'Commerciale', startsOn: '2026-01-01' },
    'positionId',
  );
  const person = (who: string) =>
    id(t.admin, '/structure/people', { name: who, accountUserId: `usr_${who}` }, 'personId');
  ids.awa = await person('awa');
  ids.kofi = await person('kofi');
  ids.yaw = await person('yaw');
  await post(t.admin, '/structure/assignments', {
    personId: ids.awa,
    positionId: ids.agent,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  ids.kofiAtHead = await id(
    t.admin,
    '/structure/assignments',
    { personId: ids.kofi, positionId: ids.head, kind: 'primary', startsOn: '2026-01-01' },
    'assignmentId',
  );
  // An app without an identity card, in Awa's space.
  ids.app = await id(
    t.awa,
    '/registry/resources',
    { kind: 'app', name: 'Caisse', address: 'https://caisse.example.test' },
    'resourceId',
  );
});
afterAll(async () => {
  await db.drop();
});

describe('an agent with a job description', () => {
  it('is created by a person for herself, and enters the registry', async () => {
    const created = await post(t.awa, '/agents', {
      name: 'Veille de mes apps',
      kind: 'personal',
      mission: "Signaler mes apps sans fiche d'identité.",
      permissions: ['registry:read'],
      watches: ['registry'],
      wakeEveryMinutes: 60,
    });
    expect(created.status).toBe(201);
    ids.watcher = String(created.body.agentId);
    expect(created.body).toMatchObject({
      responsibleUserId: 'usr_awa',
      autonomyMax: 1,
      status: 'active',
    });
    const registry = (await call(t.awa, 'GET', '/registry')).body as unknown as {
      resources: { kind: string; name: string }[];
    };
    expect(registry.resources).toContainEqual(
      expect.objectContaining({ kind: 'agent', name: 'Veille de mes apps' }),
    );
  });

  it('refuses what its creator may not give', async () => {
    const position = await post(t.awa, '/agents', {
      name: 'X',
      kind: 'position',
      positionId: ids.head,
      mission: 'X',
      watches: ['registry'],
    });
    expect(position).toMatchObject({ status: 403 });
    const watch = await post(t.awa, '/agents', {
      name: 'X',
      kind: 'personal',
      mission: 'X',
      watches: ['treasury'],
    });
    expect(watch).toMatchObject({ status: 409, body: { error: 'unknown_watch' } });
    const permission = await post(t.awa, '/agents', {
      name: 'X',
      kind: 'personal',
      mission: 'X',
      watches: ['registry'],
      permissions: ['treasury:pay'],
    });
    expect(permission).toMatchObject({ status: 422, body: { error: 'unknown_permission' } });
  });
});

describe('it sleeps, wakes and signals', () => {
  it('signals a problem once, however often it wakes', async () => {
    expect((await post(t.awa, `/agents/${ids.watcher}/wake`)).body).toMatchObject({
      acted: true,
      raised: 1,
      closed: 0,
    });
    expect((await post(t.awa, `/agents/${ids.watcher}/wake`)).body).toMatchObject({
      raised: 0,
      closed: 0,
    });
    const [mine] = await agentsOf(t.awa);
    expect(mine?.signals).toEqual([
      expect.objectContaining({ kind: 'registry.no_card', subject: 'Caisse' }),
    ]);
  });

  it('closes the signal once the problem is solved', async () => {
    cards['https://caisse.example.test'] = {
      product: 'prd_caisse',
      name: 'Caisse',
      version: '1.0.0',
      governance: {
        owner: { name: 'Finance' },
        dataCategories: ['financial'],
        ai: { used: false },
        criticality: 'high',
      },
    };
    await post(t.awa, `/registry/resources/${ids.app}/refresh`);
    expect((await post(t.awa, `/agents/${ids.watcher}/wake`)).body).toMatchObject({
      raised: 0,
      closed: 1,
    });
    expect((await agentsOf(t.awa))[0]?.signals).toEqual([]);
  });

  it('journals what it does, as an agent acting for its person', async () => {
    const journal = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'raise-signal' }),
    );
    expect(journal[0]).toMatchObject({
      actor: { kind: 'agent', id: ids.watcher },
      onBehalfOf: { kind: 'person', id: 'usr_awa' },
      channel: 'worker',
    });
  });

  it('holds no more than its job description: without « registry:read », it reads nothing there', async () => {
    cards['https://caisse.example.test'] = null;
    await post(t.awa, `/registry/resources/${ids.app}/refresh`);
    const blind = await post(t.awa, '/agents', {
      name: 'Sans droits',
      kind: 'personal',
      mission: 'Rien',
      watches: ['registry'],
    });
    expect((await post(t.awa, `/agents/${blind.body.agentId}/wake`)).body).toMatchObject({
      acted: true,
      raised: 0,
    });
  });

  it("wakes with the worker's round when its time has come, and not when paused", async () => {
    await db.owner.query(`update agents set next_wake_at = now() - interval '1 minute'`);
    const due = await dueAgents(db.app);
    expect(due.map((a) => a.agentId)).toContain(ids.watcher);
    const reports = await wakeDueAgents(() => dueAgents(db.app));
    expect(reports.find((r) => r.agentId === ids.watcher)).toMatchObject({
      acted: true,
      raised: 1,
    });
    // It sleeps until its next wake.
    expect((await dueAgents(db.app)).map((a) => a.agentId)).not.toContain(ids.watcher);
    expect((await post(t.awa, `/agents/${ids.watcher}/status`, { status: 'paused' })).status).toBe(
      201,
    );
    expect((await post(t.awa, `/agents/${ids.watcher}/wake`)).body).toMatchObject({ acted: false });
  });

  it('lets its person resolve a signal', async () => {
    await post(t.awa, `/agents/${ids.watcher}/status`, { status: 'active' });
    const [signal] = (await agentsOf(t.awa)).find((x) => x.agentId === ids.watcher)?.signals ?? [];
    expect((await post(t.kofi, `/agents/signals/${signal?.signalId}/close`)).status).toBe(403);
    expect((await post(t.awa, `/agents/signals/${signal?.signalId}/close`)).status).toBe(201);
  });

  it('stops acting, every agent at once, when an administrator switches agents off', async () => {
    await post(t.admin, '/organization/modules', { module: 'agents', enabled: false });
    try {
      await db.owner.query(`update agents set next_wake_at = now() - interval '1 minute'`);
      const reports = await wakeDueAgents(() => dueAgents(db.app));
      expect(reports.length).toBeGreaterThan(0);
      expect(reports.every((r) => !r.acted)).toBe(true);
    } finally {
      await post(t.admin, '/organization/modules', { module: 'agents', enabled: true });
    }
  });
});

describe("a position's agent", () => {
  it('acts for whoever holds the position', async () => {
    const created = await post(t.admin, '/agents', {
      name: "Agent du chef d'agence",
      kind: 'position',
      positionId: ids.head,
      mission: 'Suivre les décisions en retard.',
      watches: ['decisions'],
    });
    expect(created.status).toBe(201);
    expect((await agentsOf(t.kofi)).map((a) => a.actsFor)).toEqual(['usr_kofi']);
    await post(t.admin, `/structure/assignments/${ids.kofiAtHead}/end`, { endsOn: '2026-01-31' });
    await post(t.admin, '/structure/assignments', {
      personId: ids.yaw,
      positionId: ids.head,
      kind: 'primary',
      startsOn: '2026-02-01',
    });
    expect((await agentsOf(t.yaw)).map((a) => a.name)).toEqual(["Agent du chef d'agence"]);
    expect(await agentsOf(t.kofi)).toEqual([]);
  });

  it("keeps each organization's agents and signals to itself", async () => {
    for (const table of ['agents', 'agent_signals']) {
      await assertOrganizationIsolation({
        app: db.app,
        table,
        organizations: ['org_iso_a', 'org_iso_b'],
        insert: async (client, organization) => {
          const suffix = `${organization.slice(-1)}${table.length}`;
          await client.query(
            `insert into agents (agent_id, organization_id, name, kind, mission, responsible_user_id, watches)
             values ($1, $2, 'Iso', 'personal', 'Iso', 'usr_iso', '{registry}')`,
            [`agt_iso${suffix}`, organization],
          );
          if (table === 'agents') return;
          await client.query(
            `insert into agent_signals (signal_id, organization_id, agent_id, watch, key, kind, subject)
             values ($1, $2, $3, 'registry', 'k', 'registry.no_card', 'Iso')`,
            [`sig_iso${suffix}`, organization, `agt_iso${suffix}`],
          );
        },
      });
    }
  });
});
