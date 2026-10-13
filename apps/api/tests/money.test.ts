import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 076 (doctrine D-049): the apps say their facts of money to the center, each with its
// project and its budget post. The center adds them up — what a project received, committed and
// spent, what is left of its funds — and says when its commitments are about to be paid with
// money received for something else.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '', esi: '', yao: '', other: '' };
const ids = {} as Record<'project' | 'school' | 'party' | 'twice', string>;
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `money-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type Fact = {
  key: string;
  kind: string;
  amount: number;
  label: string;
  post?: string;
  party_id?: string;
  project_id?: string;
};
/** Gestion says a fact, with the token of who records money. */
const say = (fact: Fact, token = t.esi, project: string | null = ids.project) =>
  post(token, '/money/facts', {
    source: 'Gestion',
    fact: {
      currency: 'XOF',
      occurred_on: '2026-10-09',
      ...(project ? { project_id: project } : {}),
      ...fact,
    },
  });
type Money = {
  invoiced: number;
  received: number;
  committed: number;
  spent: number;
  available: number;
  short: number;
  outsideBudget: number;
  posts: { name: string; budget: number; committed: number; spent: number; left: number }[];
};
const moneyOf = async (token: string, projectId = ids.project) =>
  (await get(token, `/money/projects/${projectId}`)).body.money as Money;

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  t.esi = await tokenFor('usr_esi', { name: 'Esi Dossou' });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah' });
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
  const place = async (
    name: string,
    accountUserId: string,
    permissions: string[],
    reportsTo?: string,
  ) => {
    const positionId = (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title: name,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId as string;
    const personId = (await post(t.admin, '/structure/people', { name, accountUserId })).body
      .personId;
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    if (permissions.length > 0) {
      const roleId = (
        await post(t.admin, '/rights/roles', { name: `Rôle de ${name}`, permissions })
      ).body.roleId;
      await post(t.admin, '/rights/grants', { roleId, positionId, startsOn: '2026-01-01' });
    }
    return positionId;
  };
  // Awa leads projects; Kofi is in her team; Esi keeps the accounts; Yao has no right on money.
  const head = await place('Awa Mensah', 'usr_awa', ['projects:manage', 'parties:manage']);
  await place('Kofi Agbo', 'usr_kofi', [], head);
  await place('Esi Dossou', 'usr_esi', ['money:record', 'money:read']);
  await place('Yao Mensah', 'usr_yao', []);
  const party = async (name: string, phone: string) =>
    (
      (await post(t.awa, '/parties', { name, roles: ['client'], phone })).body.party as {
        partyId: string;
      }
    ).partyId;
  ids.party = await party('Garage Bè', '90 00 41 12');
  ids.twice = await party('GARAGE BE SARL', '90004112');
  const project = async (name: string, sold: number, posts: { name: string; budget: number }[]) =>
    ((await post(t.awa, '/projects', { name, sold, posts })).body.project as { projectId: string })
      .projectId;
  ids.project = await project('Chantier Garage Bè', 2_480_000, [
    { name: 'Matériel', budget: 1_450_000 },
    { name: 'Main-d’œuvre', budget: 300_000 },
    { name: 'Déplacements', budget: 150_000 },
  ]);
  ids.school = await project('Programme Écoles solaires', 12_000_000, [
    { name: 'Matériel', budget: 7_000_000 },
  ]);
  await post(t.awa, `/projects/${ids.project}/team`, { colleague: 'Kofi Agbo' });
});

afterAll(async () => {
  await db?.drop();
});

describe('a project’s available funds follow what Gestion sends', () => {
  it('is said by who records money, in the contract’s shape', async () => {
    const deposit = {
      key: 'ENC-0007',
      kind: 'received',
      amount: 992_000,
      label: 'Acompte de 40 %',
    };
    expect((await say(deposit, t.yao)).status).toBe(403);
    expect((await say(deposit)).status).toBe(201);
    // What the contract refuses is refused here.
    expect((await say({ ...deposit, key: 'x', amount: 12.5 })).status).toBe(422);
    expect((await say({ ...deposit, key: 'x', amount: -1 })).status).toBe(422);
    expect((await say({ ...deposit, key: 'x', kind: 'paid' })).status).toBe(422);
    expect(
      (
        await post(t.esi, '/money/facts', {
          source: 'Gestion',
          fact: { ...deposit, key: 'x', currency: 'XOF', occurred_on: '13/10/2026' },
        })
      ).status,
    ).toBe(422);
    // A project and a post that exist; one currency per project.
    expect((await say({ ...deposit, key: 'x' }, t.esi, 'prj_00000000-0000')).body).toMatchObject({
      error: 'unknown_project',
    });
    expect((await say({ ...deposit, key: 'x', post: 'Voyages' })).body).toMatchObject({
      error: 'unknown_post',
    });
    expect(
      (
        await post(t.esi, '/money/facts', {
          source: 'Gestion',
          fact: {
            ...deposit,
            key: 'x',
            currency: 'EUR',
            occurred_on: '2026-10-09',
            project_id: ids.project,
          },
        })
      ).body,
    ).toMatchObject({ error: 'currency_mismatch' });
    expect(await moneyOf(t.awa)).toMatchObject({ received: 992_000, spent: 0, available: 992_000 });
  });

  it('adds up what it received, committed and spent, post by post', async () => {
    await say({
      key: 'DEP-1',
      kind: 'spent',
      amount: 620_000,
      label: 'Batteries',
      post: 'Matériel',
    });
    await say({
      key: 'DEP-2',
      kind: 'spent',
      amount: 180_000,
      label: 'Pose',
      post: 'Main-d’œuvre',
    });
    await say({
      key: 'DEP-3',
      kind: 'spent',
      amount: 96_000,
      label: 'Carburant',
      post: 'Déplacements',
    });
    await say({
      key: 'BC-0031',
      kind: 'committed',
      amount: 700_000,
      label: 'Bon de commande BC-0031',
      post: 'Matériel',
      party_id: ids.party,
    });
    await say({ key: 'F-0412', kind: 'invoiced', amount: 744_000, label: 'Jalon « Livraison »' });
    expect(await moneyOf(t.awa)).toEqual({
      projectId: ids.project,
      currency: 'XOF',
      invoiced: 744_000,
      received: 992_000,
      committed: 700_000,
      spent: 896_000,
      available: 96_000,
      // Its orders exceed what is left of its funds: 604 000 F would come from other money.
      short: 604_000,
      outsideBudget: 0,
      posts: [
        { name: 'Matériel', budget: 1_450_000, committed: 700_000, spent: 620_000, left: 130_000 },
        { name: 'Main-d’œuvre', budget: 300_000, committed: 0, spent: 180_000, left: 120_000 },
        { name: 'Déplacements', budget: 150_000, committed: 0, spent: 96_000, left: 54_000 },
      ],
    });
  });

  it('replaces a fact said again, and forgets one taken back', async () => {
    // The order is paid: nothing is committed any more, and it is spent.
    await say({
      key: 'BC-0031',
      kind: 'committed',
      amount: 0,
      label: 'Bon de commande BC-0031',
      post: 'Matériel',
    });
    await say({
      key: 'PAI-0031',
      kind: 'spent',
      amount: 700_000,
      label: 'Paiement BC-0031',
      post: 'Matériel',
    });
    expect(await moneyOf(t.awa)).toMatchObject({
      committed: 0,
      spent: 1_596_000,
      // Spent beyond what it received: it lived on 604 000 F that were not its own.
      available: -604_000,
      short: 604_000,
    });
    // The milestone's invoice is paid: its funds cover it again.
    await say({ key: 'F-0412', kind: 'invoiced', amount: 0, label: 'Jalon « Livraison »' });
    await say({ key: 'ENC-0009', kind: 'received', amount: 744_000, label: 'Jalon « Livraison »' });
    expect(await moneyOf(t.awa)).toMatchObject({
      invoiced: 0,
      received: 1_736_000,
      available: 140_000,
      short: 0,
    });
    // A fact that was not true is taken back.
    await say({
      key: 'ERREUR',
      kind: 'spent',
      amount: 5_000_000,
      label: 'Saisi par erreur',
      post: 'Matériel',
    });
    expect((await moneyOf(t.awa)).available).toBe(140_000 - 5_000_000);
    expect(
      (await post(t.esi, '/money/facts/drop', { source: 'Gestion', key: 'ERREUR' })).body,
    ).toEqual({
      dropped: true,
    });
    expect(
      (await post(t.yao, '/money/facts/drop', { source: 'Gestion', key: 'ENC-0009' })).status,
    ).toBe(403);
    expect((await moneyOf(t.awa)).available).toBe(140_000);
  });

  it('counts apart what is spent outside its budget', async () => {
    await say({ key: 'DEP-9', kind: 'spent', amount: 25_000, label: 'Repas d’équipe' });
    expect(await moneyOf(t.awa)).toMatchObject({ outsideBudget: 25_000, available: 115_000 });
  });

  it('shows each figure’s pieces, with the third party that stays', async () => {
    // The third party was written twice, and merged since: the fact follows.
    await post(t.awa, '/parties/merge', { keep: ids.party, merge: ids.twice });
    await say({
      key: 'BC-0040',
      kind: 'committed',
      amount: 60_000,
      label: 'Câbles',
      post: 'Matériel',
      party_id: ids.twice,
    });
    const facts = (await get(t.awa, `/money/projects/${ids.project}`)).body.facts as {
      key: string;
      party: string | null;
      source: string;
    }[];
    expect(facts.find((fact) => fact.key === 'BC-0040')).toMatchObject({
      party: 'Garage Bè',
      source: 'Gestion',
    });
    expect(facts.some((fact) => fact.key === 'ERREUR')).toBe(false);
  });

  it('is read by its lead and by who reads the organization’s money — not by its team', async () => {
    expect((await get(t.awa, `/money/projects/${ids.project}`)).status).toBe(200);
    expect((await get(t.esi, `/money/projects/${ids.project}`)).status).toBe(200);
    // In its team, Kofi sees the project, not its money.
    expect((await get(t.kofi, `/projects/${ids.project}`)).status).toBe(200);
    expect((await get(t.kofi, `/money/projects/${ids.project}`)).status).toBe(403);
    // Outside it, the project does not exist.
    expect((await get(t.yao, `/money/projects/${ids.project}`)).status).toBe(404);
    expect((await get(t.other, `/money/projects/${ids.project}`)).status).toBe(404);
  });

  it('says what is reserved for projects, and what runs outside them', async () => {
    // A funder's instalment for another project; a rent, outside any project.
    await say(
      { key: 'ENC-0010', kind: 'received', amount: 12_000_000, label: 'Tranche 1' },
      t.esi,
      ids.school,
    );
    await say(
      { key: 'DEP-20', kind: 'spent', amount: 4_300_000, label: 'Kits', post: 'Matériel' },
      t.esi,
      ids.school,
    );
    await say(
      { key: 'LOYER-10', kind: 'committed', amount: 350_000, label: 'Loyer d’octobre' },
      t.esi,
      null,
    );
    const all = (await get(t.esi, '/money')).body as {
      organization: {
        reserved: number;
        committed: number;
        shortProjects: number;
        running: { committed: number };
      };
      projects: { name: string; money: Money }[];
    };
    expect(all.organization).toMatchObject({
      // What is left of each project's funds: 115 000 + 7 700 000. Not the organization's to spend.
      reserved: 7_815_000,
      committed: 410_000,
      running: { committed: 350_000 },
      shortProjects: 0,
    });
    expect(all.projects.map((project) => project.name).sort()).toEqual([
      'Chantier Garage Bè',
      'Programme Écoles solaires',
    ]);
    expect((await get(t.awa, '/money')).status).toBe(403);
    // A post belongs to a project: outside one, it means nothing.
    expect(
      (await say({ key: 'x', kind: 'spent', amount: 1, label: 'x', post: 'Matériel' }, t.esi, null))
        .body,
    ).toMatchObject({
      error: 'unknown_post',
    });
  });
});
