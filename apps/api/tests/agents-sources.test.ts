import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { agentToolSets, objectContextFor } from '../src/features/agents/index.js';
import { dispatchEvents } from '../src/features/events/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 104 (kete-core spec 146, ADR 0018; doctrine D-062, R5): an agent receives only the tools its
// job description's sources name, knows the object its task is about, and comes from a catalogue —
// Kete's and the apps' — that an administrator opens and each person takes for herself.

const ORG = 'org_agent_sources';

let db: TestSchema;
const api = createApi();
const t = { admin: '', kossi: '' };
let key = 0;
const ids = {} as Record<'asset' | 'thread' | 'agent' | 'project', string>;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `agent-sources-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const get = (token: string, path: string) => call(token, 'GET', path);
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);

const kossi = {
  userId: 'usr_kossi',
  email: '',
  name: 'Kossi',
  organizationId: ORG,
  role: null,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 60 * 60_000),
};

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi', org: ORG });
  for (const module of ['agents', 'datasets']) {
    await post(t.admin, '/organization/modules', { module, enabled: true });
  }
  const party = (
    (await post(t.admin, '/parties', { name: 'Mairie de Tsévié', roles: ['client'] })).body
      .party as { partyId: string }
  ).partyId;
  ids.project = (
    (
      await post(t.admin, '/projects', {
        name: 'Électrification 12 écoles',
        partyId: party,
        lead: { userId: 'usr_kossi', name: 'Kossi' },
      })
    ).body.project as { projectId: string }
  ).projectId;
  const asset = await post(t.admin, '/assets', {
    name: 'Mini-centrale · École de Tsévié',
    projectId: ids.project,
    holderUserId: 'usr_kossi',
  });
  ids.asset = (asset.body.asset as { assetId: string }).assetId;
  ids.thread = String((await get(t.admin, `/assets/${ids.asset}`)).body.threadId);
});

afterAll(async () => {
  await db?.drop();
});

type Entry = { product: string; template: { name: string }; enabled: boolean };

describe('a catalogue of agents (FR-004, FR-005)', () => {
  it('is opened by an administrator; a person sees and takes only what is open', async () => {
    expect(((await get(t.kossi, '/agents/catalogue')).body.entries as Entry[]).length).toBe(0);
    const all = (await get(t.admin, '/agents/catalogue')).body.entries as Entry[];
    expect(all.map((e) => `${e.product}:${e.template.name}:${e.enabled}`)).toEqual([
      'center:parc:false',
      'center:indicateurs:false',
    ]);
    expect((await post(t.kossi, '/agents/catalogue/center/parc/take')).status).toBe(404);
    expect((await post(t.kossi, '/agents/catalogue/center/parc/enable')).status).toBe(403);
    expect((await post(t.admin, '/agents/catalogue/center/parc/enable')).status).toBe(201);
    const open = (await get(t.kossi, '/agents/catalogue')).body.entries as Entry[];
    expect(open.map((e) => e.template.name)).toEqual(['parc']);
  });

  it('gives her an agent of her own: its mission, sources, take-on and the events it follows', async () => {
    const taken = await post(t.kossi, '/agents/catalogue/center/parc/take');
    expect(taken.status).toBe(201);
    const agent = taken.body.agent as {
      agentId: string;
      name: string;
      sources: string[];
      template: string;
      responsibleUserId: string;
      takeOn: { described: string };
    };
    ids.agent = agent.agentId;
    expect(agent).toMatchObject({
      name: 'Agent Parc',
      sources: ['kete', 'knowledge'],
      template: 'center:parc',
      responsibleUserId: 'usr_kossi',
      takeOn: { described: 'proposes' },
    });
    const followed = (await get(t.kossi, `/events/subscriptions?agent=${ids.agent}`)).body
      .subscriptions as { type: string; objectKind: string; state: string }[];
    expect(followed).toEqual([
      expect.objectContaining({
        type: 'object.state_changed',
        objectKind: 'asset',
        state: 'alert',
      }),
    ]);
  });

  it('wakes on the event it follows, its task in the object’s thread, knowing the object', async () => {
    await post(t.admin, `/assets/${ids.asset}`, { state: 'alert' });
    await dispatchEvents(ORG);
    const { rows } = await db.owner.query<{ task_id: string; thread_id: string }>(
      `select t.task_id, x.thread_id from ${db.schema}.agent_tasks t
         join ${db.schema}.agent_task_threads x using (task_id) where t.agent_id = $1`,
      [ids.agent],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.thread_id).toBe(ids.thread);
    const context = await transaction(ORG, (dbx) =>
      objectContextFor(dbx, kossi, rows[0]?.task_id ?? ''),
    );
    expect(context).toContain('Mini-centrale · École de Tsévié');
    expect(context).toContain('En alerte');
    expect(context).toContain('Électrification 12 écoles');
  });
});

describe('an agent draws only on its sources (FR-001, FR-002)', () => {
  it('receives a set of Kete’s own only when its job description names it, within its level', async () => {
    const names = async (sources: string[], autonomyMax = 3) =>
      (await agentToolSets(kossi, { sources, autonomyMax })).map((tool) => tool.name);
    expect(await names(['kete', 'knowledge'])).not.toContain('team_data_query');
    expect(await names(['kete', 'team_data'])).toContain('team_data_query');
    expect(await names(['team_data'], 0)).toEqual([]);
  });

  it('has its sources set by its person, journaled with what they were', async () => {
    const changed = await post(t.kossi, `/threads/agents/${ids.agent}/job`, {
      sources: ['kete', 'team_data'],
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ before: { sources: ['kete', 'knowledge'] } });
    expect((await post(t.kossi, `/threads/agents/${ids.agent}/job`, { sources: [] })).status).toBe(
      422,
    );
  });
});
