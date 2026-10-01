import { assertOrganizationIsolation, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import {
  isPublicIp,
  riskOf,
  useCardReader,
  type IdentityCard,
  type Resource,
} from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 004: every resource enters the registry in its owner's space, with its identity card and
// its risk, and is promoted by tiers of the organization chart by someone else who may review.

let db: TestSchema;
const api = createApi();
const t: Record<string, string> = {};
const ids: Record<string, string> = {};
let key = 0;

/** The identity cards the test apps serve at /.well-known/kete. */
const cards: Record<string, IdentityCard | null> = {
  'https://nettio.example.test': {
    product: 'prd_nettio',
    name: 'Nettio',
    version: '1.0.0',
    governance: {
      owner: { name: 'Équipe Nettio' },
      dataCategories: ['personal'],
      ai: { used: false },
      criticality: 'medium',
    },
  },
  'https://paie.example.test': {
    product: 'prd_paie',
    name: 'Paie',
    version: '1.0.0',
    governance: {
      owner: { name: 'RH' },
      dataCategories: ['personal', 'financial'],
      ai: { used: false },
      criticality: 'critical',
    },
  },
  'https://silent.example.test': null,
};

type Answer = Record<string, string>;

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
      'idempotency-key': `registry-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string | undefined, path: string, body: object = {}) =>
  call(token, 'POST', path, body);

interface Screen {
  resources: (Resource & { flags: string[] })[];
  toDecide: { promotionId: string; resourceId: string }[];
}
async function registry(token: string | undefined): Promise<Screen> {
  return (await call(token, 'GET', '/registry')).body as unknown as Screen;
}
const names = async (token: string | undefined) =>
  (await registry(token)).resources.map((r) => r.name).sort();

beforeAll(async () => {
  db = await startApi();
  useCardReader(async (address) => cards[address] ?? null);
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  for (const person of ['awa', 'esi', 'kofi', 'kojo']) {
    t[person] = await tokenFor(`usr_${person}`, { role: 'member', name: person });
  }
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = async (name: string, parentId?: string) =>
    (
      await post(t.admin, '/structure/units', {
        unitTypeId: type,
        name,
        startsOn: '2026-01-01',
        ...(parentId ? { parentId } : {}),
      })
    ).body.unitId ?? '';
  ids.group = await unit('KYA Group');
  ids.togo = await unit('KYA Togo', ids.group);
  ids.lome = await unit('Agence de Lomé', ids.togo);
  ids.kara = await unit('Agence de Kara', ids.togo);
  const place = async (who: string, unitId: string) => {
    const position = (
      await post(t.admin, '/structure/positions', { unitId, title: who, startsOn: '2026-01-01' })
    ).body.positionId;
    const person = (
      await post(t.admin, '/structure/people', { name: who, accountUserId: `usr_${who}` })
    ).body.personId;
    await post(t.admin, '/structure/assignments', {
      personId: person,
      positionId: position,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    return position ?? '';
  };
  await place('awa', ids.lome);
  await place('esi', ids.lome);
  await place('kofi', ids.kara);
  const reviewer = await place('kojo', ids.togo);
  const role = (
    await post(t.admin, '/rights/roles', {
      name: 'Revue',
      permissions: ['registry:read', 'registry:review'],
    })
  ).body.roleId;
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: reviewer,
    scopeUnitId: ids.togo,
    startsOn: '2026-01-01',
  });
});
afterAll(async () => {
  await db.drop();
});

describe('registering', () => {
  it("lands in the owner's space, with the app's card and its risk", async () => {
    const app = await post(t.awa, '/registry/resources', {
      kind: 'app',
      name: 'Nettio',
      address: 'https://nettio.example.test',
    });
    expect(app.status).toBe(201);
    ids.nettio = app.body.resourceId ?? '';
    expect(app.body).toMatchObject({
      tier: { kind: 'personal' },
      risk: 'medium',
      ownerName: 'awa',
    });
    ids.silent =
      (
        await post(t.awa, '/registry/resources', {
          kind: 'app',
          name: 'Silencieuse',
          address: 'https://silent.example.test',
        })
      ).body.resourceId ?? '';
    await post(t.awa, '/registry/resources', { kind: 'skill', name: 'Relances clients' });
    expect(await names(t.awa)).toEqual(['Nettio', 'Relances clients', 'Silencieuse']);
    // A personal space is private.
    expect(await names(t.esi)).toEqual([]);
  });

  it('flags an app without a card for the inventory', async () => {
    const inventory = await registry(t.admin);
    expect(inventory.resources.find((r) => r.name === 'Silencieuse')).toMatchObject({
      risk: 'unknown',
      flags: ['no_card'],
    });
    expect(inventory.resources.find((r) => r.name === 'Nettio')?.flags).toEqual([]);
  });

  it('accepts https addresses only', async () => {
    const plain = await post(t.awa, '/registry/resources', {
      kind: 'mcp',
      name: 'Local',
      address: 'http://10.0.0.5',
    });
    expect(plain).toMatchObject({ status: 422, body: { error: 'invalid_input' } });
  });
});

describe('promotion by tiers', () => {
  it('shares a resource with a unit once a reviewer of it approves', async () => {
    const asked = await post(t.awa, `/registry/resources/${ids.nettio}/promotions`, {
      target: { kind: 'unit', unitId: ids.lome },
    });
    expect(asked.status).toBe(201);
    const again = await post(t.awa, `/registry/resources/${ids.nettio}/promotions`, {
      target: { kind: 'organization' },
    });
    expect(again).toMatchObject({ status: 409, body: { error: 'already_pending' } });
    const pending = (await registry(t.kojo)).toDecide;
    expect(pending.map((p) => p.resourceId)).toEqual([ids.nettio]);
    const decided = await post(t.kojo, `/registry/promotions/${asked.body.promotionId}/decide`, {
      decision: 'approve',
    });
    expect(decided.status).toBe(201);
    // Visible in Lomé and below; not in Kara.
    expect(await names(t.esi)).toEqual(['Nettio']);
    expect(await names(t.kofi)).toEqual([]);
  });

  it('never lets a person decide her own request', async () => {
    const own = (
      await post(t.admin, '/registry/resources', { kind: 'skill', name: 'Brief du matin' })
    ).body.resourceId;
    const asked = await post(t.admin, `/registry/resources/${own}/promotions`, {
      target: { kind: 'organization' },
    });
    const decided = await post(t.admin, `/registry/promotions/${asked.body.promotionId}/decide`, {
      decision: 'approve',
    });
    expect(decided).toMatchObject({ status: 409, body: { error: 'own_request' } });
  });

  it('keeps a high-risk resource for a reviewer of the whole organization', async () => {
    const payroll = await post(t.awa, '/registry/resources', {
      kind: 'app',
      name: 'Paie',
      address: 'https://paie.example.test',
    });
    expect(payroll.body.risk).toBe('high');
    const asked = await post(t.awa, `/registry/resources/${payroll.body.resourceId}/promotions`, {
      target: { kind: 'unit', unitId: ids.togo },
    });
    const byScoped = await post(t.kojo, `/registry/promotions/${asked.body.promotionId}/decide`, {
      decision: 'approve',
    });
    expect(byScoped).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const byAdmin = await post(t.admin, `/registry/promotions/${asked.body.promotionId}/decide`, {
      decision: 'refuse',
      reason: 'Pas encore',
    });
    expect(byAdmin.status).toBe(201);
  });

  it('retires a resource, which then cannot be promoted', async () => {
    expect((await post(t.kofi, `/registry/resources/${ids.silent}/retire`)).status).toBe(403);
    expect((await post(t.awa, `/registry/resources/${ids.silent}/retire`)).status).toBe(201);
    const promoted = await post(t.awa, `/registry/resources/${ids.silent}/promotions`, {
      target: { kind: 'organization' },
    });
    expect(promoted).toMatchObject({ status: 409, body: { error: 'retired' } });
  });
});

describe('the rules underneath', () => {
  it('derives the risk from the card', () => {
    expect(riskOf(null)).toBe('unknown');
    expect(riskOf(cards['https://nettio.example.test'] ?? null)).toBe('medium');
    expect(riskOf(cards['https://paie.example.test'] ?? null)).toBe('high');
  });

  it('reads cards from public addresses only', () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ['13.140.178.49', '8.8.8.8', '2a00:1450:4007::1']) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it("keeps each organization's resources and promotions to itself", async () => {
    for (const table of ['resources', 'promotions']) {
      await assertOrganizationIsolation({
        app: db.app,
        table,
        organizations: ['org_iso_a', 'org_iso_b'],
        insert: async (client, organization) => {
          const suffix = `${organization.slice(-1)}${table.length}`;
          await client.query(
            `insert into resources (resource_id, organization_id, kind, name, owner_user_id,
               owner_name, tier_kind) values ($1, $2, 'skill', 'Iso', 'usr_iso', 'Iso', 'personal')`,
            [`res_iso${suffix}`, organization],
          );
          if (table === 'resources') return;
          await client.query(
            `insert into promotions (promotion_id, organization_id, resource_id, target_kind,
               requested_by) values ($1, $2, $3, 'organization', 'usr_iso')`,
            [`prm_iso${suffix}`, organization, `res_iso${suffix}`],
          );
        },
      });
    }
  });
});
