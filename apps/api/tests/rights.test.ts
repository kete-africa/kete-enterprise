import { assertOrganizationIsolation, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import type { Chart } from '../src/features/structure/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 003: rights follow the structure. A role is granted to a position or a person, on a
// subtree, a country or the whole organization, for a period; the structure obeys it.

let db: TestSchema;
const api = createApi();
const tokens: Record<'admin' | 'kofi' | 'esi' | 'yaw', string> = {
  admin: '',
  kofi: '',
  esi: '',
  yaw: '',
};
let key = 0;

type Answer = Record<string, string>;

async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `rights-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const post = (token: string, path: string, body: object) => call(token, 'POST', path, body);

async function visibleUnits(token: string, asOf: string): Promise<string[]> {
  const response = await api.request(`/v1/structure?asOf=${asOf}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as Chart).units.map((u) => u.name).sort();
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await startApi();
  tokens.admin = await tokenFor('usr_ama', { role: 'admin' });
  tokens.kofi = await tokenFor('usr_kofi', { role: 'member' });
  tokens.esi = await tokenFor('usr_esi', { role: 'member' });
  tokens.yaw = await tokenFor('usr_yaw', { role: 'member' });

  // KYA: a group, two entities in two countries, two branches in Togo.
  const admin = tokens.admin;
  const type = async (k: string, legalEntity = false) =>
    (await post(admin, '/structure/unit-types', { key: k, name: k, legalEntity })).body
      .unitTypeId ?? '';
  const group = await type('group');
  const entity = await type('legal_entity', true);
  const branch = await type('branch');
  const unit = async (name: string, unitTypeId: string, parentId?: string, country?: string) =>
    (
      await post(admin, '/structure/units', {
        unitTypeId,
        name,
        startsOn: '2026-01-01',
        ...(parentId ? { parentId } : {}),
        ...(country ? { country } : {}),
      })
    ).body.unitId ?? '';
  ids.group = await unit('KYA Group', group);
  ids.togo = await unit('KYA Togo', entity, ids.group, 'TG');
  ids.ghana = await unit('KYA Ghana', entity, ids.group, 'GH');
  ids.lome = await unit('Agence de Lomé', branch, ids.togo);
  ids.kara = await unit('Agence de Kara', branch, ids.togo);
  const position = async (unitId: string, title: string) =>
    (await post(admin, '/structure/positions', { unitId, title, startsOn: '2026-01-01' })).body
      .positionId ?? '';
  ids.branchHead = await position(ids.lome, "Chef d'agence");
  ids.hr = await position(ids.togo, 'Responsable RH');
  const person = async (name: string, accountUserId: string) =>
    (await post(admin, '/structure/people', { name, accountUserId })).body.personId ?? '';
  ids.kofi = await person('Kofi', 'usr_kofi');
  ids.esi = await person('Esi', 'usr_esi');
  ids.yaw = await person('Yaw', 'usr_yaw');
  const assign = async (personId: string, positionId: string, startsOn: string, endsOn?: string) =>
    (
      await post(admin, '/structure/assignments', {
        personId,
        positionId,
        kind: 'primary',
        startsOn,
        ...(endsOn ? { endsOn } : {}),
      })
    ).body.assignmentId ?? '';
  ids.kofiAtLome = await assign(ids.kofi, ids.branchHead, '2026-01-01', '2026-06-30');
  await assign(ids.yaw, ids.branchHead, '2026-07-01');
  await assign(ids.esi, ids.hr, '2026-01-01');

  // Roles, granted to positions: whoever holds them has their rights.
  const role = async (name: string, permissions: string[]) =>
    (await post(admin, '/rights/roles', { name, permissions })).body.roleId ?? '';
  const branchRole = await role("Chef d'agence", ['structure:read']);
  const hrRole = await role('RH pays', ['structure:read', 'structure:write']);
  await post(admin, '/rights/grants', {
    roleId: branchRole,
    positionId: ids.branchHead,
    scopeUnitId: ids.lome,
    startsOn: '2026-01-01',
  });
  ids.hrGrant =
    (
      await post(admin, '/rights/grants', {
        roleId: hrRole,
        positionId: ids.hr,
        scopeCountry: 'TG',
        startsOn: '2026-01-01',
      })
    ).body.grantId ?? '';
});
afterAll(async () => {
  await db.drop();
});

describe('a role granted with a scope', () => {
  it('lets a branch manager see his branch only', async () => {
    expect(await visibleUnits(tokens.kofi, '2026-03-01')).toEqual(['Agence de Lomé']);
  });

  it('covers a country: the entities of that country and everything under them', async () => {
    expect(await visibleUnits(tokens.esi, '2026-03-01')).toEqual([
      'Agence de Kara',
      'Agence de Lomé',
      'KYA Togo',
    ]);
  });

  it('gives a person without a grant the units where she holds a position, and nothing else', async () => {
    expect(await visibleUnits(tokens.yaw, '2026-03-01')).toEqual([]);
  });

  it('moves with the position: the new holder has the rights, the former one no longer', async () => {
    expect(await visibleUnits(tokens.yaw, '2026-07-01')).toEqual(['Agence de Lomé']);
    expect(await visibleUnits(tokens.kofi, '2026-07-01')).toEqual([]);
  });

  it('says what the person may do, and where', async () => {
    const me = await call(tokens.esi, 'GET', '/rights/me?asOf=2026-03-01');
    const reaches = (me.body as unknown as { reaches: { permission: string; units: string[] }[] })
      .reaches;
    expect(reaches.map((r) => r.permission)).toEqual(['structure:read', 'structure:write']);
    expect(reaches[0]?.units.sort()).toEqual([ids.kara, ids.lome, ids.togo].sort());
  });
});

describe('the structure under rights', () => {
  it('lets the HR officer draw in her country, and refuses elsewhere', async () => {
    const branchType = (await call(tokens.admin, 'GET', '/structure?asOf=2026-03-01'))
      .body as unknown as Chart;
    const branch = branchType.unitTypes.find((t) => t.key === 'branch')?.unitTypeId;
    const inTogo = await post(tokens.esi, '/structure/units', {
      unitTypeId: branch,
      parentId: ids.kara,
      name: 'Point de vente de Kara',
    });
    expect(inTogo.status).toBe(201);
    const inGhana = await post(tokens.esi, '/structure/units', {
      unitTypeId: branch,
      parentId: ids.ghana,
      name: 'Agence de Kumasi',
    });
    expect(inGhana).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const vocabulary = await post(tokens.esi, '/structure/unit-types', {
      key: 'team',
      name: 'team',
    });
    expect(vocabulary.status).toBe(403);
  });

  it('refuses a reader any change', async () => {
    const position = await post(tokens.kofi, '/structure/positions', {
      unitId: ids.lome,
      title: 'Caissier',
    });
    expect(position).toMatchObject({ status: 403, body: { error: 'forbidden' } });
  });

  it('ends with its grant', async () => {
    const revoked = await post(tokens.admin, `/rights/grants/${ids.hrGrant}/revoke`, {
      endsOn: '2026-09-30',
    });
    expect(revoked.status).toBe(201);
    expect(await visibleUnits(tokens.esi, '2026-09-30')).toContain('Agence de Kara');
    // Afterwards, only the unit where she holds her position.
    expect(await visibleUnits(tokens.esi, '2026-10-01')).toEqual(['KYA Togo']);
  });
});

describe('administering rights', () => {
  it("belongs to the organization's owners and admins, and checks the catalog", async () => {
    const byMember = await post(tokens.kofi, '/rights/roles', { name: 'Moi', permissions: [] });
    expect(byMember).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const unknown = await post(tokens.admin, '/rights/roles', {
      name: 'Inconnu',
      permissions: ['treasury:pay'],
    });
    expect(unknown).toMatchObject({ status: 422, body: { error: 'unknown_permission' } });
    const both = await post(tokens.admin, '/rights/grants', {
      roleId: 'rol_00000000-0000-0000-0000-000000000000',
      positionId: ids.hr,
      personId: ids.esi,
    });
    expect(both).toMatchObject({ status: 422, body: { error: 'invalid_input' } });
  });

  it("keeps each organization's roles and grants to itself", async () => {
    for (const table of ['roles', 'role_grants']) {
      await assertOrganizationIsolation({
        app: db.app,
        table,
        organizations: ['org_iso_a', 'org_iso_b'],
        insert: async (client, organization) => {
          const suffix = `${organization.slice(-1)}${table.length}`;
          await client.query(
            `insert into roles (role_id, organization_id, name) values ($1, $2, $3)`,
            [`rol_iso${suffix}`, organization, `iso ${table}`],
          );
          if (table === 'roles') return;
          await client.query(
            `insert into people (person_id, organization_id, name) values ($1, $2, 'Iso')`,
            [`prs_iso${suffix}`, organization],
          );
          await client.query(
            `insert into role_grants (grant_id, organization_id, role_id, person_id)
             values ($1, $2, $3, $4)`,
            [`grt_iso${suffix}`, organization, `rol_iso${suffix}`, `prs_iso${suffix}`],
          );
        },
      });
    }
  });
});
