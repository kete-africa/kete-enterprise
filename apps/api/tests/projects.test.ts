import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 074 (doctrine D-047): a project is one object. Born from a sentence or from an app's
// document, it has its dossier (thread, files), its team, its client and its budget by post. It is
// a reference of the center, and belonging to it is a second axis of rights.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '', esi: '', other: '' };
const ids = {} as Record<'party' | 'project' | 'kofis', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `projects-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type Project = {
  projectId: string;
  name: string;
  dossierId: string;
  party: { name: string } | null;
  lead: { userId: string; name: string };
  status: string;
  sold: number | null;
  budget: number;
  expectedMargin: number | null;
  team: { userId: string; name: string; lead: boolean }[];
  posts: { name: string; budget: number }[];
  bornFrom: { source: string; ref: string } | null;
};
const read = async (token: string, projectId: string) =>
  (await get(token, `/projects/${projectId}`)).body.project as Project;
const namesOf = async (token: string) =>
  ((await get(token, '/projects')).body.projects as Project[]).map((project) => project.name);

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
      name: 'Technique',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  const position = async (title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
  const assign = async (name: string, accountUserId: string, positionId: string) => {
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  };
  const head = await position('Responsable technique');
  await assign('Awa Mensah', 'usr_awa', head);
  await assign('Kofi Agbo', 'usr_kofi', await position('Technicien', head));
  await assign('Esi Dossou', 'usr_esi', await position('Comptable'));
  const roleId = (
    await post(t.admin, '/rights/roles', {
      name: 'Projets',
      permissions: ['projects:manage', 'parties:manage'],
    })
  ).body.roleId;
  await post(t.admin, '/rights/grants', { roleId, positionId: head, startsOn: '2026-01-01' });
  await post(t.admin, '/organization/modules', { module: 'dossiers', enabled: true });
  ids.party = String(
    (
      (await post(t.awa, '/parties', { name: 'Garage Bè', roles: ['client'] })).body.party as {
        partyId: string;
      }
    ).partyId,
  );
});

afterAll(async () => {
  await db?.drop();
});

describe('a project is one object', () => {
  it('is born from a sentence: a name is enough, and it has its team and its thread', async () => {
    expect((await post(t.kofi, '/projects', { name: 'Chantier Garage Bè' })).status).toBe(403);
    const made = await post(t.awa, '/projects', { name: 'Chantier Garage Bè' });
    expect(made.status).toBe(201);
    const project = made.body.project as Project;
    ids.project = project.projectId;
    expect(project).toMatchObject({
      name: 'Chantier Garage Bè',
      status: 'open',
      lead: { userId: 'usr_awa', name: 'Awa Mensah' },
      team: [{ userId: 'usr_awa', lead: true }],
      posts: [],
      budget: 0,
      sold: null,
      expectedMargin: null,
    });
    // Its thread and its files: the dossier born with it, open to its team.
    const dossier = await get(t.awa, `/dossiers/${project.dossierId}`);
    expect(dossier.status).toBe(200);
    expect(JSON.stringify(dossier.body)).toContain('Chantier Garage Bè');
  });

  it('shows its client, its budget by post, and what it should earn', async () => {
    await post(t.awa, `/projects/${ids.project}`, { sold: 2_480_000, phase: 'Exécution' });
    for (const [name, budget] of [
      ['Matériel', 1_450_000],
      ['Main-d’œuvre', 300_000],
      ['Déplacements', 150_000],
    ] as const) {
      expect((await post(t.awa, `/projects/${ids.project}/posts`, { name, budget })).status).toBe(
        200,
      );
    }
    // A post set again is changed, not doubled.
    await post(t.awa, `/projects/${ids.project}/posts`, { name: 'Déplacements', budget: 150_000 });
    expect(await read(t.awa, ids.project)).toMatchObject({
      sold: 2_480_000,
      budget: 1_900_000,
      expectedMargin: 580_000,
      posts: [
        { name: 'Matériel', budget: 1_450_000 },
        { name: 'Main-d’œuvre', budget: 300_000 },
        { name: 'Déplacements', budget: 150_000 },
      ],
    });
    expect(
      (await post(t.awa, `/projects/${ids.project}/posts`, { name: 'Matériel', budget: 1.5 }))
        .status,
    ).toBe(422);
  });

  it('is a second axis of rights: its team reads it, nobody else does', async () => {
    expect(await namesOf(t.kofi)).toEqual([]);
    expect((await get(t.kofi, `/projects/${ids.project}`)).status).toBe(404);
    const joined = await post(t.awa, `/projects/${ids.project}/team`, { colleague: 'Kofi Agbo' });
    expect((joined.body.project as Project).team.map((member) => member.name).sort()).toEqual([
      'Awa Mensah',
      'Kofi Agbo',
    ]);
    // Kofi holds no right on projects: he sees this one because he is in its team.
    expect(await namesOf(t.kofi)).toEqual(['Chantier Garage Bè']);
    expect((await get(t.kofi, '/projects/mine')).body.projectIds).toEqual([ids.project]);
    expect((await read(t.kofi, ids.project)).budget).toBe(1_900_000);
    // In its team, he reads its thread too.
    const dossierId = (await read(t.kofi, ids.project)).dossierId;
    expect((await get(t.kofi, `/dossiers/${dossierId}`)).status).toBe(200);
    // Outside it: a colleague, another organization.
    expect(await namesOf(t.esi)).toEqual([]);
    expect((await get(t.esi, `/projects/${ids.project}`)).status).toBe(404);
    expect(await namesOf(t.other)).toEqual([]);
    expect((await get(t.other, `/projects/${ids.project}`)).status).toBe(404);
    // A member reads; only its lead, or who manages projects, changes it.
    expect(
      (await post(t.kofi, `/projects/${ids.project}/posts`, { name: 'Divers', budget: 1 })).status,
    ).toBe(403);
  });

  it('is born from an app’s document once, its lines as posts', async () => {
    const quote = {
      name: 'Maintenance Hôtel du Golfe',
      sold: 3_600_000,
      lead: { userId: 'usr_kofi', name: 'Kofi Agbo' },
      bornFrom: { source: 'Gestion', ref: 'D-0098' },
      posts: [
        { name: 'Pièces', budget: 1_200_000 },
        { name: 'Main-d’œuvre', budget: 900_000 },
        // Two lines of the quote on the same post add up.
        { name: 'Pièces', budget: 100_000 },
      ],
    };
    const made = await post(t.awa, '/projects', quote);
    expect(made.status).toBe(201);
    const project = made.body.project as Project;
    ids.kofis = project.projectId;
    expect(project).toMatchObject({
      bornFrom: { source: 'Gestion', ref: 'D-0098' },
      lead: { userId: 'usr_kofi' },
      budget: 2_200_000,
      expectedMargin: 1_400_000,
    });
    expect(project.posts).toEqual([
      expect.objectContaining({ name: 'Pièces', budget: 1_300_000 }),
      expect.objectContaining({ name: 'Main-d’œuvre', budget: 900_000 }),
    ]);
    // Who created it is in its team beside its lead.
    expect(project.team.map((member) => member.userId).sort()).toEqual(['usr_awa', 'usr_kofi']);
    // Asked again by the app, it is the same project.
    const again = await post(t.awa, '/projects', quote);
    expect(again.status).toBe(200);
    expect((again.body.project as Project).projectId).toBe(ids.kofis);
    expect(await namesOf(t.awa)).toHaveLength(2);
  });

  it('is changed by its lead, without any right on projects', async () => {
    const changed = await post(t.kofi, `/projects/${ids.kofis}/posts`, {
      name: 'Déplacements',
      budget: 200_000,
    });
    expect((changed.body.project as Project).budget).toBe(2_400_000);
    expect((await post(t.kofi, `/projects/${ids.kofis}`, { phase: 'Visite 1' })).status).toBe(200);
    // Its lead stays in its team.
    expect(
      (await post(t.awa, `/projects/${ids.kofis}/team`, { colleague: 'Kofi Agbo', on: false }))
        .body,
    ).toMatchObject({ error: 'lead_stays' });
  });

  it('names a third party of the center, and nothing else', async () => {
    expect(
      (await post(t.awa, '/projects', { name: 'X', partyId: 'pty_00000000-0000' })).status,
    ).toBe(404);
    const made = await post(t.awa, '/projects', { name: 'Devis Garage', partyId: ids.party });
    expect((made.body.project as Project).party).toMatchObject({ name: 'Garage Bè' });
  });

  it('is read once closed, and changes again only when reopened', async () => {
    await post(t.awa, `/projects/${ids.project}`, { status: 'closed' });
    expect(
      (await post(t.awa, `/projects/${ids.project}/posts`, { name: 'Matériel', budget: 1 })).body,
    ).toMatchObject({ error: 'project_closed' });
    expect((await post(t.awa, `/projects/${ids.project}`, { phase: 'Fin' })).body).toMatchObject({
      error: 'project_closed',
    });
    expect((await read(t.awa, ids.project)).status).toBe('closed');
    await post(t.awa, `/projects/${ids.project}`, { status: 'open' });
    expect(
      (await post(t.awa, `/projects/${ids.project}/posts`, { name: 'Matériel', budget: 1_450_000 }))
        .status,
    ).toBe(200);
  });
});
