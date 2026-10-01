import { readJournal } from '@kete/commands';
import { inOrganization } from '@kete/tenancy';
import { assertOrganizationIsolation, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import type { Chart } from '../src/features/structure/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 002: an organization drawn as of a date, by its owners and admins, every change journaled,
// each organization alone.

let db: TestSchema;
const api = createApi();
let admin: string;
let member: string;
let otherAdmin: string;
let key = 0;

beforeAll(async () => {
  db = await startApi();
  admin = await tokenFor('usr_awa', { role: 'admin' });
  member = await tokenFor('usr_kofi', { role: 'member' });
  otherAdmin = await tokenFor('usr_eve', { role: 'owner', org: 'org_other' });
});
afterAll(async () => {
  await db.drop();
});

/** A gesture through the API, as the screens send it. */
async function post(
  token: string,
  path: string,
  body: object,
  idempotencyKey = `test-key-${++key}`,
) {
  const response = await api.request(`/v1/structure${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'kete-channel': 'web',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

/** What a gesture answers: the created thing's identifiers, or a refusal. */
type Answer = Record<
  'unitTypeId' | 'unitId' | 'positionId' | 'personId' | 'assignmentId' | 'error',
  string
>;

async function chart(token: string, asOf?: string): Promise<Chart> {
  const response = await api.request(`/v1/structure${asOf ? `?asOf=${asOf}` : ''}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Chart;
}

describe('drawing the organization', () => {
  let group: string;
  let togo: string;
  let lome: string;
  let director: string;
  let branchHead: string;
  let ama: string;

  it('creates unit types, units under one another, positions and people', async () => {
    const holding = await post(admin, '/unit-types', { key: 'group', name: 'Groupe' });
    const entity = await post(admin, '/unit-types', {
      key: 'legal_entity',
      name: 'Entité juridique',
      legalEntity: true,
    });
    const branch = await post(admin, '/unit-types', { key: 'branch', name: 'Agence' });
    expect([holding.status, entity.status, branch.status]).toEqual([201, 201, 201]);

    group = (
      await post(admin, '/units', {
        unitTypeId: holding.body.unitTypeId,
        name: 'KYA Group',
        startsOn: '2026-01-01',
      })
    ).body.unitId;
    togo = (
      await post(admin, '/units', {
        unitTypeId: entity.body.unitTypeId,
        parentId: group,
        name: 'KYA Togo',
        country: 'TG',
        startsOn: '2026-01-01',
      })
    ).body.unitId;
    lome = (
      await post(admin, '/units', {
        unitTypeId: branch.body.unitTypeId,
        parentId: togo,
        name: 'Agence de Lomé',
        startsOn: '2026-01-01',
      })
    ).body.unitId;
    director = (
      await post(admin, '/positions', {
        unitId: group,
        title: 'Directeur général',
        startsOn: '2026-01-01',
      })
    ).body.positionId;
    branchHead = (
      await post(admin, '/positions', {
        unitId: lome,
        title: "Chef d'agence",
        reportsTo: director,
        startsOn: '2026-01-01',
      })
    ).body.positionId;
    ama = (await post(admin, '/people', { name: 'Ama Mensah', email: 'ama@example.test' })).body
      .personId;
    const assigned = await post(admin, '/assignments', {
      personId: ama,
      positionId: branchHead,
      kind: 'primary',
      startsOn: '2026-02-01',
    });
    expect(assigned.status).toBe(201);

    const today = await chart(member, '2026-06-01');
    expect(today.units.map((u) => u.name).sort()).toEqual([
      'Agence de Lomé',
      'KYA Group',
      'KYA Togo',
    ]);
    expect(today.units.find((u) => u.unitId === togo)).toMatchObject({
      parentId: group,
      country: 'TG',
    });
    // The line crosses units: the branch head reports to the group's director.
    expect(today.positions.find((p) => p.positionId === branchHead)).toMatchObject({
      reportsTo: director,
    });
    expect(today.assignments).toEqual([
      expect.objectContaining({ personId: ama, positionId: branchHead, kind: 'primary' }),
    ]);
  });

  it('reads the past as it was', async () => {
    // Before Ama's assignment began, the position was empty.
    expect((await chart(member, '2026-01-15')).assignments).toEqual([]);
    const ended = await post(
      admin,
      `/assignments/${(await chart(member, '2026-06-01')).assignments.at(0)?.assignmentId ?? ''}/end`,
      {
        endsOn: '2026-08-31',
      },
    );
    expect(ended.status).toBe(201);
    expect((await chart(member, '2026-08-31')).assignments).toHaveLength(1);
    expect((await chart(member, '2026-09-01')).assignments).toHaveLength(0);
  });

  it('gives a person one primary position at a time, but other kinds beside it', async () => {
    const again = await post(admin, '/assignments', {
      personId: ama,
      positionId: director,
      kind: 'primary',
      startsOn: '2026-08-01',
    });
    expect(again).toMatchObject({ status: 409, body: { error: 'primary_overlap' } });
    const interim = await post(admin, '/assignments', {
      personId: ama,
      positionId: director,
      kind: 'interim',
      startsOn: '2026-08-01',
      endsOn: '2026-08-15',
    });
    expect(interim.status).toBe(201);
    const after = await post(admin, '/assignments', {
      personId: ama,
      positionId: director,
      kind: 'primary',
      startsOn: '2026-09-01',
    });
    expect(after.status).toBe(201);
  });

  it('moves a unit with its subtree, never under itself', async () => {
    const cycle = await post(admin, `/units/${group}/move`, { parentId: lome });
    expect(cycle).toMatchObject({ status: 409, body: { error: 'cycle' } });
    const moved = await post(admin, `/units/${lome}/move`, { parentId: group });
    expect(moved.status).toBe(201);
    expect((await chart(member, '2026-06-01')).units.find((u) => u.unitId === lome)?.parentId).toBe(
      group,
    );
  });

  it('closes a unit at a date: it disappears from later charts only', async () => {
    expect((await post(admin, `/units/${togo}/close`, { endsOn: '2026-12-31' })).status).toBe(201);
    expect((await chart(member, '2026-12-31')).units.some((u) => u.unitId === togo)).toBe(true);
    expect((await chart(member, '2027-01-01')).units.some((u) => u.unitId === togo)).toBe(false);
  });
});

describe('safe and traced', () => {
  it('lets a member read, never change', async () => {
    const refused = await post(member, '/unit-types', { key: 'team', name: 'Équipe' });
    expect(refused).toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });

  it('journals every change, with its actor and channel, and runs a key once', async () => {
    const first = await post(
      admin,
      '/unit-types',
      { key: 'project', name: 'Projet' },
      'same-key-1',
    );
    const replay = await post(
      admin,
      '/unit-types',
      { key: 'project', name: 'Projet' },
      'same-key-1',
    );
    expect(replay.body).toEqual(first.body);
    const conflict = await post(
      admin,
      '/unit-types',
      { key: 'other', name: 'Autre' },
      'same-key-1',
    );
    expect(conflict).toMatchObject({ status: 409, body: { error: 'idempotency_conflict' } });
    const journal = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'create-unit-type' }),
    );
    expect(journal.filter((entry) => entry.summary === 'Unit type "Projet" created')).toHaveLength(
      1,
    );
    expect(journal[0]).toMatchObject({ actor: { kind: 'person', id: 'usr_awa' }, channel: 'web' });
    // A person's details stay out of the journal.
    const people = await inOrganization(db.app, 'org_kya', (tx) =>
      readJournal(tx, { name: 'add-person' }),
    );
    expect(JSON.stringify(people)).not.toContain('ama@example.test');
  });

  it('refuses invalid input and a key-less gesture', async () => {
    const invalid = await post(admin, '/units', { name: '' });
    expect(invalid).toMatchObject({ status: 422, body: { error: 'invalid_input' } });
    const response = await api.request('/v1/structure/unit-types', {
      method: 'POST',
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'team', name: 'Équipe' }),
    });
    expect(response.status).toBe(422);
  });

  it('keeps each organization alone, even through a foreign identifier', async () => {
    const ownType = await post(admin, '/unit-types', { key: 'office', name: 'Bureau' });
    const foreignUnit = (
      await post(admin, '/units', { unitTypeId: ownType.body.unitTypeId, name: 'Bureau privé' })
    ).body.unitId;
    expect((await chart(otherAdmin, '2026-06-01')).units).toEqual([]);
    const type = await post(otherAdmin, '/unit-types', { key: 'branch', name: 'Agence' });
    const intruding = await post(otherAdmin, '/units', {
      unitTypeId: type.body.unitTypeId,
      parentId: foreignUnit,
      name: 'Intrus',
    });
    expect(intruding).toMatchObject({ status: 404, body: { error: 'not_found' } });
    for (const table of ['unit_types', 'units', 'positions', 'people', 'assignments']) {
      await assertOrganizationIsolation({
        app: db.app,
        table,
        organizations: ['org_iso_a', 'org_iso_b'],
        insert: async (client, organization) => {
          await client.query(
            `insert into unit_types (unit_type_id, organization_id, key, name)
             values ($1, $2, $3, 'Iso')`,
            [`utp_iso${organization.slice(-1)}${table.length}xx`, organization, `iso_${table}`],
          );
          if (table === 'unit_types') return;
          await client.query(
            `insert into units (unit_id, organization_id, unit_type_id, name)
             values ($1, $2, $3, 'Iso')`,
            [
              `unt_iso${organization.slice(-1)}${table.length}xx`,
              organization,
              `utp_iso${organization.slice(-1)}${table.length}xx`,
            ],
          );
          if (table === 'units') return;
          await client.query(
            `insert into positions (position_id, organization_id, unit_id, title)
             values ($1, $2, $3, 'Iso')`,
            [
              `pos_iso${organization.slice(-1)}${table.length}xx`,
              organization,
              `unt_iso${organization.slice(-1)}${table.length}xx`,
            ],
          );
          await client.query(
            `insert into people (person_id, organization_id, name) values ($1, $2, 'Iso')`,
            [`prs_iso${organization.slice(-1)}${table.length}xx`, organization],
          );
          if (table !== 'assignments') return;
          await client.query(
            `insert into assignments (assignment_id, organization_id, person_id, position_id, kind, starts_on)
             values ($1, $2, $3, $4, 'primary', '2026-01-01')`,
            [
              `asg_iso${organization.slice(-1)}${table.length}xx`,
              organization,
              `prs_iso${organization.slice(-1)}${table.length}xx`,
              `pos_iso${organization.slice(-1)}${table.length}xx`,
            ],
          );
        },
      });
    }
  });
});
