import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 023: the team's apps read the organization with the person's token — who she is, where she
// sits, who her manager is; a colleague or a unit when her rights reach them; otherwise, unknown.

let db: TestSchema;
const api = createApi();
const t = { admin: '', abla: '', kossi: '', kofi: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `directory-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = async (path: string, body: object) => (await call(t.admin, 'POST', path, body)).body;

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.abla = await tokenFor('usr_abla');
  t.kossi = await tokenFor('usr_kossi');
  t.kofi = await tokenFor('usr_kofi');
  const type = (await post('/structure/unit-types', { key: 'unit', name: 'Unité' }))
    .unitTypeId as string;
  const unit = async (name: string, parentId?: string) =>
    (
      await post('/structure/units', {
        unitTypeId: type,
        name,
        startsOn: '2026-01-01',
        ...(parentId ? { parentId } : {}),
      })
    ).unitId as string;
  ids.group = await unit('KYA-Energy Group');
  ids.technique = await unit('Direction Technique & Projets', ids.group);
  ids.sav = await unit('Service après-vente', ids.technique);
  const position = async (unitId: string, title: string, reportsTo?: string) =>
    (
      await post('/structure/positions', {
        unitId,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).positionId as string;
  ids.dt = await position(ids.technique, 'Directrice technique');
  ids.chef = await position(ids.sav, 'Chef de service SAV', ids.dt);
  ids.tech = await position(ids.sav, 'Technicien SAV', ids.chef);
  const person = async (name: string, accountUserId: string, email: string) =>
    (await post('/structure/people', { name, accountUserId, email })).personId as string;
  const assign = async (personId: string, positionId: string) =>
    post('/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  await assign(await person('Abla', 'usr_abla', 'abla@kya.test'), ids.dt);
  await assign(await person('Kossi', 'usr_kossi', 'kossi@kya.test'), ids.chef);
  await assign(await person('Kofi', 'usr_kofi', 'kofi@kya.test'), ids.tech);
});

afterAll(async () => {
  await db?.drop();
});

describe('the directory, as an app reads it', () => {
  it('says who the person is, where she sits and who her manager is', async () => {
    const me = await call(t.kofi, 'GET', '/directory/me');
    expect(me.body).toMatchObject({
      name: 'Kofi',
      userId: 'usr_kofi',
      positions: [{ title: 'Technicien SAV', unitName: 'Service après-vente' }],
      managers: [{ name: 'Kossi', userId: 'usr_kossi', email: 'kossi@kya.test' }],
      reports: [],
    });
    expect(me.body).not.toHaveProperty('phone');
    const kossi = await call(t.kossi, 'GET', '/directory/me');
    expect(kossi.body).toMatchObject({ managers: [{ name: 'Abla' }], reports: [{ name: 'Kofi' }] });
  });

  it('shows a colleague to her manager and her reports, and to whoever reads the structure', async () => {
    expect((await call(t.kofi, 'GET', '/directory/people/usr_kossi')).status).toBe(200);
    expect((await call(t.kossi, 'GET', '/directory/people/usr_kofi')).status).toBe(200);
    expect((await call(t.admin, 'GET', '/directory/people/usr_abla')).status).toBe(200);
    // Kofi and Abla are not linked, and Kofi reads no structure: Abla is unknown to him.
    expect((await call(t.kofi, 'GET', '/directory/people/usr_abla')).status).toBe(404);
  });

  it('shows a unit, its place and its people, to whoever belongs to it', async () => {
    const sav = await call(t.kofi, 'GET', `/directory/units/${ids.sav}`);
    expect(sav.body).toMatchObject({
      name: 'Service après-vente',
      ancestors: [{ name: 'KYA-Energy Group' }, { name: 'Direction Technique & Projets' }],
      children: [],
    });
    expect((sav.body.people as Answer[]).map((p) => p.name).sort()).toEqual(['Kofi', 'Kossi']);
    expect((await call(t.kofi, 'GET', `/directory/units/${ids.group}`)).status).toBe(404);
    expect((await call(t.admin, 'GET', `/directory/units/${ids.group}`)).status).toBe(200);
  });
});
