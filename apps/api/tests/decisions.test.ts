import { assertOrganizationIsolation, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 005: an approval circuit, described as data, finds its approvers in the structure and the
// rights at the time they look; the registry's promotions go through it.

let db: TestSchema;
const api = createApi();
const t: Record<string, string> = {};
const ids: Record<string, string> = {};
let key = 0;

const card = (criticality: 'medium' | 'critical'): IdentityCard => ({
  product: 'prd_test',
  name: 'Test',
  version: '1.0.0',
  governance: {
    owner: { name: 'Owner' },
    dataCategories: ['personal'],
    ai: { used: false },
    criticality,
  },
});

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
      'idempotency-key': `decisions-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string | undefined, path: string, body: object = {}) =>
  call(token, 'POST', path, body);

interface InboxItem {
  requestId: string;
  title: string;
  status: string;
  currentStep: number | null;
  overdue: boolean;
  steps: { position: number; status: string }[];
}
async function inbox(token: string | undefined) {
  return (await call(token, 'GET', '/decisions/inbox')).body as unknown as {
    toDecide: InboxItem[];
    mine: InboxItem[];
  };
}
const titles = async (token: string | undefined) =>
  (await inbox(token)).toDecide.map((r) => r.title).sort();

/** A resource registered by `who`, then a promotion to `unitId` (or the organization) asked. */
async function promote(who: string, name: string, address: string, unitId?: string) {
  const resource = (await post(t[who], '/registry/resources', { kind: 'app', name, address })).body
    .resourceId;
  const asked = await post(t[who], `/registry/resources/${resource}/promotions`, {
    target: unitId ? { kind: 'unit', unitId } : { kind: 'organization' },
  });
  expect(asked.status).toBe(201);
  return { resource: resource ?? '', request: asked.body.decisionRequestId ?? '' };
}

beforeAll(async () => {
  db = await startApi();
  useCardReader(async (address) =>
    address.includes('critical') ? card('critical') : card('medium'),
  );
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  for (const who of ['awa', 'kofi', 'esi', 'yaw', 'zoe'])
    t[who] = await tokenFor(`usr_${who}`, { role: 'member', name: who });

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
  const position = async (unitId: string, title: string, reportsTo?: string) =>
    (
      await post(t.admin, '/structure/positions', {
        unitId,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      })
    ).body.positionId ?? '';
  ids.dg = await position(ids.group, 'Directeur général');
  ids.director = await position(ids.togo, 'Directrice Togo', ids.dg);
  ids.head = await position(ids.lome, "Chef d'agence", ids.director);
  ids.agent = await position(ids.lome, 'Commerciale', ids.head);
  const person = async (who: string, positionId: string, kind = 'primary', endsOn?: string) => {
    const personId =
      (await post(t.admin, '/structure/people', { name: who, accountUserId: `usr_${who}` })).body
        .personId ?? '';
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind,
      startsOn: '2026-01-01',
      ...(endsOn ? { endsOn } : {}),
    });
    return personId;
  };
  await person('awa', ids.agent);
  await person('kofi', ids.head);
  await person('esi', ids.director);
  await person('yaw', ids.dg);
  ids.zoe = await person('zoe', ids.agent, 'functional');

  const role =
    (await post(t.admin, '/rights/roles', { name: 'Revue', permissions: ['registry:review'] })).body
      .roleId ?? '';
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: ids.dg,
    startsOn: '2026-01-01',
  });

  // Promotions: the requester's manager, then — for high risk only — a reviewer.
  const circuit = await post(t.admin, '/decisions/circuits', {
    subject: 'registry.promotion',
    name: 'Promotion des ressources',
    remindAfterHours: 24,
    steps: [{ rule: 'manager' }, { rule: 'role', roleId: role, minMeasure: 3 }],
  });
  expect(circuit.status).toBe(201);
});
afterAll(async () => {
  await db.drop();
});

/** The titles of a person's notifications (spec 030). */
async function told(token: string | undefined): Promise<string[]> {
  const body = (await call(token ?? '', 'GET', '/notifications')).body as unknown as {
    notifications: { title: string }[];
  };
  return body.notifications.map((n) => n.title);
}

describe('an approval circuit', () => {
  it("sends a request to the requester's manager, and carries the decision out", async () => {
    const { resource, request } = await promote(
      'awa',
      'Nettio',
      'https://nettio.example.test',
      ids.lome,
    );
    expect(request).toMatch(/^drq_/);
    expect(await titles(t.kofi)).toEqual(['Nettio']);
    // The approver is told (spec 030); the requester is not.
    expect(await told(t.kofi)).toContainEqual(expect.stringContaining('Nettio'));
    expect(await told(t.awa)).toEqual([]);
    expect(await titles(t.esi)).toEqual([]);
    // Never the requester, never through the registry's direct review.
    expect(
      await post(t.awa, `/decisions/requests/${request}/decide`, { decision: 'approve' }),
    ).toMatchObject({ status: 403, body: { error: 'not_an_approver' } });
    // The medium-risk request skipped the reviewer's step.
    expect((await inbox(t.awa)).mine[0]?.steps.map((s) => s.status)).toEqual([
      'pending',
      'skipped',
    ]);
    expect(
      (await post(t.kofi, `/decisions/requests/${request}/decide`, { decision: 'approve' })).body
        .status,
    ).toBe('approved');
    const registry = (await call(t.awa, 'GET', '/registry')).body as unknown as {
      resources: { resourceId: string; tier: { kind: string } }[];
    };
    expect(registry.resources.find((r) => r.resourceId === resource)?.tier).toEqual({
      kind: 'unit',
      unitId: ids.lome,
    });
  });

  it('adds a step from a threshold: a high-risk resource also needs a reviewer', async () => {
    const { request } = await promote('awa', 'Paie', 'https://critical.example.test', ids.lome);
    expect(
      (await post(t.kofi, `/decisions/requests/${request}/decide`, { decision: 'approve' })).body,
    ).toMatchObject({ status: 'pending', step: 2 });
    expect(await titles(t.kofi)).toEqual([]);
    expect(await titles(t.yaw)).toEqual(['Paie']);
    expect(await told(t.yaw)).toContainEqual(expect.stringContaining('Paie'));
    expect(
      (await post(t.yaw, `/decisions/requests/${request}/decide`, { decision: 'approve' })).body
        .status,
    ).toBe('approved');
  });

  it('ends at the first refusal: the resource stays where it was', async () => {
    const { resource, request } = await promote(
      'awa',
      'Brouillon',
      'https://draft.example.test',
      ids.lome,
    );
    expect(
      (
        await post(t.kofi, `/decisions/requests/${request}/decide`, {
          decision: 'refuse',
          reason: 'Pas prête',
        })
      ).body.status,
    ).toBe('refused');
    const registry = (await call(t.awa, 'GET', '/registry')).body as unknown as {
      resources: { resourceId: string; tier: { kind: string } }[];
    };
    expect(registry.resources.find((r) => r.resourceId === resource)?.tier).toEqual({
      kind: 'personal',
    });
    expect(
      await post(t.kofi, `/decisions/requests/${request}/decide`, { decision: 'approve' }),
    ).toMatchObject({ status: 409, body: { error: 'decided' } });
  });

  it("follows a delegation: whoever holds the manager's position by delegation decides", async () => {
    const delegate = await post(t.admin, '/structure/assignments', {
      personId: ids.zoe,
      positionId: ids.head,
      kind: 'delegation',
      startsOn: '2026-01-01',
    });
    expect(delegate.status).toBe(201);
    const { request } = await promote('awa', 'Agenda', 'https://agenda.example.test', ids.lome);
    expect(await titles(t.zoe)).toEqual(['Agenda']);
    expect(
      (await post(t.zoe, `/decisions/requests/${request}/decide`, { decision: 'approve' })).body
        .status,
    ).toBe('approved');
  });

  it("sends a step that finds nobody else to the organization's administrators", async () => {
    // The director general reports to nobody.
    const { request } = await promote('yaw', 'Tableau de bord', 'https://board.example.test');
    expect(await titles(t.admin)).toContain('Tableau de bord');
    expect(await titles(t.esi)).not.toContain('Tableau de bord');
    expect(
      (await post(t.admin, `/decisions/requests/${request}/decide`, { decision: 'approve' })).body
        .status,
    ).toBe('approved');
  });

  it('flags a step that waits longer than its circuit allows', async () => {
    const { request } = await promote('awa', 'Ancienne', 'https://old.example.test', ids.lome);
    await db.owner.query(
      `update decision_steps set entered_at = now() - interval '2 days' where request_id = $1`,
      [request],
    );
    expect((await inbox(t.kofi)).toDecide.find((r) => r.requestId === request)?.overdue).toBe(true);
  });
});

describe('circuits', () => {
  it('belong to whoever manages decisions, for known subjects only', async () => {
    expect(
      (
        await post(t.kofi, '/decisions/circuits', {
          subject: 'registry.promotion',
          name: 'X',
          steps: [{ rule: 'manager' }],
        })
      ).status,
    ).toBe(403);
    const unknown = await post(t.admin, '/decisions/circuits', {
      subject: 'treasury.payment',
      name: 'X',
      steps: [{ rule: 'manager' }],
    });
    expect(unknown).toMatchObject({ status: 409, body: { error: 'unknown_subject' } });
  });

  it("keep each organization's circuits and requests to itself", async () => {
    for (const table of ['circuits', 'decision_requests']) {
      await assertOrganizationIsolation({
        app: db.app,
        table,
        organizations: ['org_iso_a', 'org_iso_b'],
        insert: async (client, organization) => {
          const suffix = `${organization.slice(-1)}${table.length}`;
          await client.query(
            `insert into circuits (circuit_id, organization_id, subject, name) values ($1, $2, $3, 'Iso')`,
            [`cir_iso${suffix}`, organization, `iso.subject_${organization.slice(-1)}${table[0]}`],
          );
          if (table === 'circuits') return;
          await client.query(
            `insert into decision_requests (request_id, organization_id, circuit_id, subject,
               reference, title, requester_user_id) values ($1, $2, $3, 'iso.x', $4, 'Iso', 'usr_iso')`,
            [`drq_iso${suffix}`, organization, `cir_iso${suffix}`, `ref_${suffix}`],
          );
        },
      });
    }
  });
});
