import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { nameKey, phoneKey } from '../src/features/parties/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 073 (doctrine D-047): a third party is one record, held by the center and cited by every
// app. The same company may be a client and a supplier. Each app says what it knows of it.
// Duplicates are proposed and merged by a person — and whoever cites the merged record follows.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '', esi: '', other: '' };
const ids = {} as Record<'hotel' | 'hotelTwice' | 'garage' | 'garageTwice', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `parties-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type Party = {
  partyId: string;
  name: string;
  roles: string[];
  phone: string | null;
  mergedFrom: string[];
};
const create = async (body: object) =>
  ((await post(t.awa, '/parties', body)).body.party as Party).partyId;
const names = async (token: string, query = '') =>
  ((await get(token, `/parties${query}`)).body.parties as Party[]).map((party) => party.name);

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi Dossou' });
  t.other = await tokenFor('usr_ailleurs', { org: 'org_ailleurs', role: 'admin' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Ventes',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  const place = async (name: string, accountUserId: string, permissions: string[]) => {
    const positionId = (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title: name,
        startsOn: '2026-01-01',
      })
    ).body.positionId;
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    if (permissions.length === 0) return;
    const roleId = (await post(t.admin, '/rights/roles', { name: `Tiers de ${name}`, permissions }))
      .body.roleId;
    await post(t.admin, '/rights/grants', { roleId, positionId, startsOn: '2026-01-01' });
  };
  await place('Awa Mensah', 'usr_awa', ['parties:manage']);
  await place('Kofi Agbo', 'usr_kofi', ['parties:read']);
  await place('Esi Dossou', 'usr_esi', []);
});

afterAll(async () => {
  await db?.drop();
});

describe('a third party is one record, cited by every app', () => {
  it('is written by who manages third parties, and read by who reads them', async () => {
    ids.hotel = await create({
      name: 'Hôtel du Golfe',
      roles: ['client'],
      phone: '+228 90 12 34 56',
      channel: 'whatsapp',
    });
    ids.garage = await create({ name: 'Garage Bè', roles: ['client'] });
    expect(await names(t.kofi)).toEqual(['Garage Bè', 'Hôtel du Golfe']);
    expect((await post(t.kofi, '/parties', { name: 'Solartech' })).status).toBe(403);
    expect((await get(t.esi, '/parties')).status).toBe(403);
    expect((await get(t.esi, `/parties/${ids.hotel}`)).status).toBe(403);
    expect((await post(t.awa, '/parties', { name: '' })).status).toBe(422);
    // Another organization sees none of them.
    expect(await names(t.other)).toEqual([]);
    expect((await get(t.other, `/parties/${ids.hotel}`)).status).toBe(404);
  });

  it('is found by its name without case nor accent, by its phone, by its role', async () => {
    expect(await names(t.kofi, '?q=hotel')).toEqual(['Hôtel du Golfe']);
    expect(await names(t.kofi, '?q=GARAGE%20BE')).toEqual(['Garage Bè']);
    expect(await names(t.kofi, '?q=90123456')).toEqual(['Hôtel du Golfe']);
    expect(await names(t.kofi, '?role=supplier')).toEqual([]);
    expect(nameKey('GARAGE BÈ S.A.R.L.')).toBe(nameKey('Garage Bè'));
    expect(phoneKey('00228 90-12-34-56')).toBe(phoneKey('90 12 34 56'));
  });

  it('carries what each app knows of it', async () => {
    // Apps speak with the token of a person who reads third parties.
    const said = await post(t.kofi, `/parties/${ids.hotel}/facts`, {
      source: 'Gestion',
      key: 'F-0412',
      label: 'Facture F-0412 · 2 480 000 F',
      state: 'Due depuis 6 jours',
      href: 'https://gestion.kete.test/factures/F-0412',
    });
    expect(said.status).toBe(201);
    expect(
      (await post(t.esi, `/parties/${ids.hotel}/facts`, { source: 'X', key: 'x', label: 'x' }))
        .status,
    ).toBe(403);
    // Said again, it is replaced, not doubled.
    await post(t.kofi, `/parties/${ids.hotel}/facts`, {
      source: 'Gestion',
      key: 'F-0412',
      label: 'Facture F-0412 · 2 480 000 F',
      state: 'Payée',
    });
    const fiche = (await get(t.kofi, `/parties/${ids.hotel}`)).body;
    expect(fiche.facts).toMatchObject([{ source: 'Gestion', key: 'F-0412', state: 'Payée' }]);
  });

  it('is proposed as a duplicate by its phone or its name, to who may merge', async () => {
    // The same hotel, written by someone else as a supplier; the same garage with its legal form.
    ids.hotelTwice = await create({
      name: 'Hotel du Golf SARL',
      roles: ['supplier'],
      phone: '90123456',
      email: 'compta@hoteldugolfe.test',
    });
    ids.garageTwice = await create({ name: 'GARAGE BE SARL', roles: ['client'] });
    await post(t.kofi, `/parties/${ids.hotelTwice}/facts`, {
      source: 'Support',
      key: 'T-112',
      label: 'T-112 · Onduleur en panne',
      state: 'Critique',
    });
    expect((await get(t.kofi, '/parties/duplicates')).status).toBe(403);
    const found = (await get(t.awa, '/parties/duplicates')).body.duplicates as {
      a: { partyId: string };
      b: { partyId: string };
      because: string[];
    }[];
    const pair = (x: string, y: string) =>
      found.find((d) => [d.a.partyId, d.b.partyId].sort().join() === [x, y].sort().join());
    expect(pair(ids.hotel, ids.hotelTwice)?.because).toEqual(['phone']);
    expect(pair(ids.garage, ids.garageTwice)?.because).toEqual(['name']);
    expect(found).toHaveLength(2);
  });

  it('is merged by a person: one record stays, and every app follows', async () => {
    const both = { keep: ids.hotel, merge: ids.hotelTwice };
    expect((await post(t.kofi, '/parties/merge', both)).status).toBe(403);
    const merged = await post(t.awa, '/parties/merge', both);
    expect(merged.body.party).toMatchObject({
      partyId: ids.hotel,
      name: 'Hôtel du Golfe',
      // A client and a supplier at once.
      roles: ['client', 'supplier'],
      mergedFrom: [ids.hotelTwice],
    });
    // What the one that stays lacked comes from the other.
    expect((merged.body.party as { email: string }).email).toBe('compta@hoteldugolfe.test');
    // An app that kept the old identifier is led to the record that stays, with all that is known.
    const followed = (await get(t.kofi, `/parties/${ids.hotelTwice}`)).body as {
      party: Party;
      facts: { source: string }[];
    };
    expect(followed.party.partyId).toBe(ids.hotel);
    expect(followed.facts.map((fact) => fact.source).sort()).toEqual(['Gestion', 'Support']);
    // And an app may go on saying what it knows under the old identifier.
    await post(t.kofi, `/parties/${ids.hotelTwice}/facts`, {
      source: 'Engagements',
      key: 'CTR-7',
      label: 'Contrat de maintenance',
    });
    expect(((await get(t.kofi, `/parties/${ids.hotel}`)).body.facts as unknown[]).length).toBe(3);
    // The merged record is no longer listed, nor proposed, nor merged twice.
    expect(await names(t.kofi, '?q=golf')).toEqual(['Hôtel du Golfe']);
    expect((await post(t.awa, '/parties/merge', both)).status).toBe(409);
    expect(
      (await post(t.awa, '/parties/merge', { keep: ids.hotel, merge: ids.hotel })).status,
    ).toBe(409);
  });

  it('is kept distinct when a person says two records are not the same', async () => {
    const pair = { keep: ids.garage, merge: ids.garageTwice };
    expect((await post(t.awa, '/parties/distinct', pair)).status).toBe(200);
    expect((await get(t.awa, '/parties/duplicates')).body.duplicates).toEqual([]);
    expect(await names(t.kofi, '?q=garage')).toEqual(['GARAGE BE SARL', 'Garage Bè']);
  });

  it('is corrected by who manages third parties', async () => {
    const changed = await post(t.awa, `/parties/${ids.garage}`, {
      roles: ['client', 'partner'],
      phone: '91 00 00 01',
    });
    expect(changed.body.party).toMatchObject({
      roles: ['client', 'partner'],
      phone: '91 00 00 01',
    });
    expect((await post(t.kofi, `/parties/${ids.garage}`, { name: 'X' })).status).toBe(403);
    expect(await names(t.kofi, '?q=91000001')).toEqual(['Garage Bè']);
  });
});
