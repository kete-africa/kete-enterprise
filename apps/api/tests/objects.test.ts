import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { gatewayCapabilities } from '../src/features/gateway/index.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { asPerson } from '../src/platform/acting.js';
import { transaction } from '../src/platform/db.js';
import { useAppVerifier } from '../src/platform/identity.js';
import { startApi, tokenFor } from './support.js';

// Spec 100 (kete-core spec 142; doctrine D-062, R1, R2, R4, R15): the objects at the center. A
// project, a third party, a unit keep their row in the index by themselves; a place and an asset
// are born with their thread; Support says its tickets with its own token. Each person reads what
// her rights already give her — her own, her project's, her unit's — and « # », Kete and the
// agents find them all the same way.

const ORG = 'org_objects';

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', yao: '', essi: '' };
let key = 0;
const ids = {} as Record<
  'party' | 'project' | 'sav' | 'compta' | 'place' | 'asset' | 'essi',
  string
>;

const supportCard: IdentityCard & { objects: object[] } = {
  product: 'prd_support',
  name: 'Support',
  version: '1.0.0',
  client: 'cli_support',
  objects: [
    {
      kind: 'ticket',
      label: { fr: 'Ticket', en: 'Ticket' },
      states: [
        { id: 'open', label: { fr: 'Ouvert', en: 'Open' }, tone: 'verify' },
        { id: 'solved', label: { fr: 'Résolu', en: 'Solved' }, tone: 'ok', closed: true },
      ],
      axes: ['party', 'unit', 'person'],
      links: [
        {
          relation: 'concerns',
          to: 'asset',
          label: { fr: 'concerne', en: 'concerns' },
          inverse: { fr: 'concernée par', en: 'concerned by' },
        },
      ],
      href: 'https://support.example.test/tickets/{id}',
    },
  ],
};

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `objects-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: Answer = {};
  try {
    parsed = JSON.parse(text) as Answer;
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed };
}
const post = (token: string, path: string, body: object = {}) =>
  call(token, 'POST', `/v1${path}`, body);
const get = (token: string, path: string) => call(token, 'GET', `/v1${path}`);
type Found = { kind: string; id: string; title: string; stateLabel: string | null };
const find = async (token: string, query = '') =>
  ((await get(token, `/objects${query}`)).body.objects ?? []) as Found[];
const say = (objects: object[], token = 'app:cli_support') =>
  call(token, 'PUT', '/public/apps/objects', {
    organization: ORG,
    product: 'prd_support',
    objects,
  });

beforeAll(async () => {
  db = await startApi();
  useAppVerifier(async (token) => {
    if (!token.startsWith('app:')) throw new Error('not an app');
    return {
      clientId: token.slice(4),
      scopes: ['kete:center'],
      expiresAt: new Date(Date.now() + 60_000),
    };
  });
  useCardReader(async (address) => (address.includes('support') ? supportCard : null));
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.abla = await tokenFor('usr_abla', { name: 'Abla Kpodar', org: ORG });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah', org: ORG });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah', org: ORG });
  t.essi = await tokenFor('usr_essi', { name: 'Essi Lawson', org: ORG });
  expect(
    (
      await post(t.admin, '/registry/resources', {
        kind: 'app',
        name: 'Support',
        address: 'https://support.example.test',
      })
    ).status,
  ).toBe(201);
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = async (name: string) =>
    String(
      (await post(t.admin, '/structure/units', { unitTypeId: type, name, startsOn: '2026-01-01' }))
        .body.unitId,
    );
  ids.sav = await unit('Agence Maritime');
  ids.compta = await unit('Comptabilité');
  const place = async (unitId: string, title: string, accountUserId: string, name: string) => {
    const positionId = String(
      (await post(t.admin, '/structure/positions', { unitId, title, startsOn: '2026-01-01' })).body
        .positionId,
    );
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    if (accountUserId === 'usr_essi') ids.essi = String(personId);
  };
  await place(ids.sav, 'Chef d’agence', 'usr_abla', 'Abla Kpodar');
  await place(ids.sav, 'Technicien', 'usr_yao', 'Yao Mensah');
  await place(ids.compta, 'Comptable', 'usr_essi', 'Essi Lawson');
  await place(ids.compta, 'Chef de projet', 'usr_kossi', 'Kossi Amegah');
  ids.party = String(
    (
      (await post(t.admin, '/parties', { name: 'Mairie de Tsévié', roles: ['client'] })).body
        .party as { partyId: string }
    ).partyId,
  );
  ids.project = String(
    (
      (
        await post(t.admin, '/projects', {
          name: 'Électrification 12 écoles',
          partyId: ids.party,
          lead: { userId: 'usr_kossi', name: 'Kossi Amegah' },
        })
      ).body.project as { projectId: string }
    ).projectId,
  );
});

afterAll(async () => {
  await db?.drop();
});

describe('the center’s references, in the index by themselves', () => {
  it('lists a project, a third party and a unit as objects, with their states', async () => {
    const all = await find(t.admin, '?limit=200');
    expect(all.find((o) => o.id === ids.project)).toMatchObject({
      kind: 'project',
      title: 'Électrification 12 écoles',
      stateLabel: 'En cours',
    });
    expect(all.some((o) => o.kind === 'party' && o.id === ids.party)).toBe(true);
    expect(all.some((o) => o.kind === 'unit' && o.id === ids.sav)).toBe(true);
    const kinds = (await get(t.abla, '/objects/kinds')).body.kinds as {
      kind: string;
      product: string;
    }[];
    expect(kinds.map((k) => k.kind)).toEqual(
      expect.arrayContaining(['party', 'project', 'unit', 'place', 'asset', 'ticket']),
    );
    expect(kinds.find((k) => k.kind === 'ticket')?.product).toBe('prd_support');
  });
});

describe('a place and an asset', () => {
  it('are declared by who manages the objects, born with their thread and their links', async () => {
    expect((await post(t.yao, '/assets', { name: 'X' })).status).toBe(403);
    const place = await post(t.admin, '/places', {
      name: 'École primaire de Tsévié',
      subtype: 'site',
      unitId: ids.sav,
      partyId: ids.party,
    });
    expect(place.status).toBe(201);
    ids.place = (place.body.place as { placeId: string }).placeId;
    const asset = await post(t.admin, '/assets', {
      name: 'Mini-centrale · École de Tsévié',
      subtype: 'mini-centrale',
      projectId: ids.project,
      partyId: ids.party,
      unitId: ids.sav,
      placeId: ids.place,
      holderUserId: 'usr_yao',
      commissionedOn: '2025-03-14',
      facts: [{ label: 'Puissance', value: '24 kWc' }],
    });
    expect(asset.status).toBe(201);
    ids.asset = (asset.body.asset as { assetId: string }).assetId;
    expect((await post(t.admin, '/assets', { name: 'Y', placeId: 'plc_0000000000' })).status).toBe(
      422,
    );
    const read = await get(t.yao, `/assets/${ids.asset}`);
    expect(read.status).toBe(200);
    expect(read.body.threadId).toMatch(/^thr_/);
    expect(read.body.changeable).toBe(true);
    type Link = { relation: string; label: string; direction: string; object: Found };
    const linksOf = (body: Answer) =>
      (body.links as Link[]).map((l) => [l.relation, l.label, l.direction, l.object.kind]);
    // Yao answers for it but is not on the project's team: the project stays out of his sight (R4).
    expect(linksOf(read.body)).toEqual([['located_at', 'se trouve à', 'out', 'place']]);
    // Kossi leads the project, not the agency nor the client: he sees what it produced, not where.
    expect(linksOf((await get(t.kossi, `/assets/${ids.asset}`)).body)).toEqual([
      ['produced_by', 'produit par', 'out', 'project'],
    ]);
    expect(linksOf((await get(t.admin, `/assets/${ids.asset}`)).body)).toEqual(
      expect.arrayContaining([
        ['produced_by', 'produit par', 'out', 'project'],
        ['located_at', 'se trouve à', 'out', 'place'],
      ]),
    );
    const project = (await get(t.kossi, `/objects/project/${ids.project}`)).body;
    expect(
      (project.links as { label: string; object: Found }[]).map((l) => [l.label, l.object.id]),
    ).toEqual([['a produit', ids.asset]]);
  });

  it('changes its state by who answers for it; the index follows', async () => {
    expect((await post(t.essi, `/assets/${ids.asset}`, { state: 'alert' })).status).toBe(404);
    expect((await post(t.yao, `/assets/${ids.asset}`, { state: 'alert' })).status).toBe(200);
    const [found] = await find(t.yao, `?kind=asset&state=alert`);
    expect(found).toMatchObject({ id: ids.asset, stateLabel: 'En alerte' });
  });
});

describe('what each person sees of the index', () => {
  it('follows her rights: her own, her project, her unit — never more', async () => {
    const seen = async (token: string) => (await find(token, '?kind=asset')).map((o) => o.id);
    expect(await seen(t.yao)).toEqual([ids.asset]); // she answers for it, and works in its unit
    expect(await seen(t.abla)).toEqual([ids.asset]); // her unit
    expect(await seen(t.kossi)).toEqual([ids.asset]); // his project
    // An object she may read names what it belongs to, without opening it: Yao reads no third
    // party, yet his asset names its client.
    const listed = (await get(t.yao, '/objects?kind=asset')).body.titles as Record<string, string>;
    expect(listed[`party:${ids.party}`]).toBe('Mairie de Tsévié');
    expect((await get(t.yao, `/objects/party/${ids.party}`)).status).toBe(404);
    expect(await seen(t.essi)).toEqual([]); // nothing of hers
    expect((await get(t.essi, `/objects/asset/${ids.asset}`)).status).toBe(404);
    const role = (
      await post(t.admin, '/rights/roles', { name: 'Parc', permissions: ['objects:read'] })
    ).body.roleId;
    await post(t.admin, '/rights/grants', {
      roleId: role,
      personId: ids.essi,
      scopeUnitId: ids.sav,
      startsOn: '2026-01-01',
    });
    expect(await seen(t.essi)).toEqual([ids.asset]); // objects:read over the agency
  });
});

describe('an app’s objects', () => {
  const ticket = (extra: Record<string, unknown> = {}) => ({
    kind: 'ticket',
    id: 'T-0412',
    title: 'T-0412 · Onduleur 2 hors ligne',
    state: 'open',
    party_id: ids.party,
    unit_id: ids.sav,
    person_id: 'usr_yao',
    links: [{ relation: 'concerns', kind: 'asset', id: ids.asset }],
    updated_at: '2026-10-23T09:12:00Z',
    ...extra,
  });

  it('are taken only from the app, in its declared kinds, states and links', async () => {
    expect((await say([ticket()], t.abla)).status).toBe(401);
    expect((await say([ticket()], 'app:cli_stranger')).status).toBe(404);
    expect((await say([ticket({ kind: 'invoice' })])).status).toBe(422);
    expect((await say([ticket({ state: 'lost' })])).status).toBe(422);
    expect(
      (await say([ticket({ links: [{ relation: 'covers', kind: 'asset', id: ids.asset }] })]))
        .status,
    ).toBe(422);
    expect((await say([ticket({ fields: { power: 24 } })])).status).toBe(422);
    const said = await say([ticket()]);
    expect(said).toMatchObject({ status: 200, body: { said: 1, gone: 0, stale: 0 } });
  });

  it('meet the center’s objects by their named links, read both ways', async () => {
    const card = (await get(t.yao, `/objects/asset/${ids.asset}`)).body;
    expect(
      (card.links as { label: string; direction: string; object: Found }[]).find(
        (l) => l.object.kind === 'ticket',
      ),
    ).toMatchObject({ label: 'concernée par', direction: 'in', object: { id: 'T-0412' } });
    const ticketCard = (await get(t.yao, '/objects/ticket/T-0412')).body;
    expect(ticketCard.object).toMatchObject({
      stateLabel: 'Ouvert',
      href: 'https://support.example.test/tickets/T-0412',
    });
  });

  it('never let an older saying replace a newer one, and leave when gone', async () => {
    const older = await say([ticket({ title: 'old', updated_at: '2026-10-01T00:00:00Z' })]);
    expect(older.body).toMatchObject({ said: 0, stale: 1 });
    expect((await find(t.yao, '?kind=ticket'))[0]?.title).toBe('T-0412 · Onduleur 2 hors ligne');
    const solved = await say([ticket({ state: 'solved', updated_at: '2026-10-24T10:00:00Z' })]);
    expect(solved.body).toMatchObject({ said: 1 });
    expect(await find(t.yao, '?kind=ticket')).toEqual([]);
    expect(await find(t.yao, '?kind=ticket&closed=true')).toHaveLength(1);
    const gone = await say([{ kind: 'ticket', id: 'T-0412', title: 'x', gone: true }]);
    expect(gone.body).toMatchObject({ gone: 1 });
    expect(await find(t.yao, '?kind=ticket&closed=true')).toEqual([]);
    expect((await say([ticket({ updated_at: '2026-10-25T00:00:00Z' })])).status).toBe(200);
  });
});

describe('found the same way everywhere', () => {
  it('« # » offers the asset and the ticket with their states', async () => {
    const offered = (await get(t.yao, '/threads/objects?q=Tsévié')).body.objects as {
      kind: string;
      label: string;
      state: string | null;
    }[];
    expect(offered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'asset', state: 'En alerte' }),
        expect.objectContaining({ kind: 'place', label: 'École primaire de Tsévié' }),
      ]),
    );
    const tickets = (await get(t.yao, '/threads/objects?q=Onduleur')).body.objects as {
      kind: string;
      app?: string;
    }[];
    expect(tickets).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ticket', app: 'prd_support' })]),
    );
  });

  it('Kete and the agents find and read objects with the person’s rights', async () => {
    type Runnable = { run: (input: unknown, context: unknown) => Promise<unknown> };
    const tool = (name: string) =>
      gatewayCapabilities.find((c) => c.name === name) as unknown as Runnable;
    const acting = (userId: string) => ({
      userId,
      role: 'member' as const,
      organizationId: ORG,
      name: userId,
    });
    const asYao = await transaction(ORG, (dbx) =>
      asPerson(acting('usr_yao') as never, () =>
        tool('objects_find').run({ unitId: ids.sav, closed: false } as never, { db: dbx } as never),
      ),
    );
    expect((asYao as { kind: string }[]).map((o) => o.kind)).toEqual(
      expect.arrayContaining(['asset', 'ticket', 'place']),
    );
    const read = await transaction(ORG, (dbx) =>
      asPerson(acting('usr_yao') as never, () =>
        tool('object_read').run({ kind: 'asset', id: ids.asset } as never, { db: dbx } as never),
      ),
    );
    expect(read).toMatchObject({ found: true, hasThread: true });
    const hidden = await transaction(ORG, (dbx) =>
      asPerson(acting('usr_nobody') as never, () =>
        tool('object_read').run({ kind: 'asset', id: ids.asset } as never, { db: dbx } as never),
      ),
    );
    expect(hidden).toEqual({ found: false });
  });

  it('a fact of money names its object', async () => {
    const kept = await post(t.admin, '/money/facts', {
      source: 'test',
      fact: {
        key: 'F-1',
        kind: 'invoiced',
        amount: 100000,
        currency: 'XOF',
        occurred_on: '2026-10-20',
        label: 'Facture F-1',
        object: { kind: 'asset', id: ids.asset },
      },
    });
    expect(kept.status).toBe(201);
    const rows = await db.owner.query<{ object_kind: string; object_id: string }>(
      `select object_kind, object_id from ${db.schema}.money_facts where key = 'F-1'`,
    );
    expect(rows.rows[0]).toEqual({ object_kind: 'asset', object_id: ids.asset });
  });
});
