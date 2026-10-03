import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 022: an app declares its permissions in its card; an administrator puts them in roles,
// granted like Kete Enterprise's own; the app reads what a person holds, with her token. Until a
// role carries one of them, the app keeps its defaults (`managed: false`).

let db: TestSchema;
const api = createApi();
const t = { ama: '', kofi: '', esi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `app-perm-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}

const card: IdentityCard = {
  product: 'prd_kete_helpdesk',
  name: 'Support',
  version: '1.0.0',
  permissions: [
    {
      name: 'tickets:read',
      label: { fr: 'Lire les tickets', en: 'Read tickets' },
      roles: ['owner', 'admin', 'member'],
    },
    {
      name: 'tickets:manage',
      label: { fr: 'Gérer les files', en: 'Manage queues' },
      description: { fr: 'Files, délais, indicateurs', en: 'Queues, deadlines, indicators' },
      roles: ['owner', 'admin'],
    },
  ],
};

let personKofi = '';

beforeAll(async () => {
  db = await startApi();
  useCardReader(async (address) => (address.includes('helpdesk') ? card : null));
  t.ama = await tokenFor('usr_ama', { role: 'admin' });
  t.kofi = await tokenFor('usr_kofi');
  t.esi = await tokenFor('usr_esi');
  await call(t.ama, 'POST', '/registry/resources', {
    kind: 'app',
    name: 'Support',
    address: 'https://helpdesk.example.test',
  });
  personKofi = (
    await call(t.ama, 'POST', '/structure/people', {
      name: 'Kofi',
      accountUserId: 'usr_kofi',
    })
  ).body.personId as string;
});

afterAll(async () => {
  await db?.drop();
});

describe('an app’s permissions', () => {
  it('are offered to roles, with their words, by app', async () => {
    const catalog = (await call(t.ama, 'GET', '/rights/permissions')).body;
    expect(catalog.apps).toEqual([
      expect.objectContaining({
        product: 'prd_kete_helpdesk',
        appName: 'Support',
        permissions: [
          expect.objectContaining({ key: 'prd_kete_helpdesk#tickets:read', name: 'tickets:read' }),
          expect.objectContaining({
            key: 'prd_kete_helpdesk#tickets:manage',
            label: { fr: 'Gérer les files', en: 'Manage queues' },
          }),
        ],
      }),
    ]);
  });

  it('keep the app’s defaults until a role carries one of them', async () => {
    expect((await call(t.kofi, 'GET', '/apps/prd_kete_helpdesk/grants')).body).toEqual({
      managed: false,
      permissions: [],
    });
    expect((await call(t.kofi, 'GET', '/apps/prd_unknown_app/grants')).body).toEqual({
      managed: false,
      permissions: [],
    });
  });

  it('refuse a permission no app declares', async () => {
    const refused = await call(t.ama, 'POST', '/rights/roles', {
      name: 'Inventé',
      permissions: ['prd_kete_helpdesk#tickets:delete'],
    });
    expect(refused).toMatchObject({ status: 422, body: { error: 'unknown_permission' } });
  });

  it('once granted, say what the person holds and where; others hold nothing', async () => {
    const role = await call(t.ama, 'POST', '/rights/roles', {
      name: 'Chef de service SAV',
      permissions: ['prd_kete_helpdesk#tickets:read', 'prd_kete_helpdesk#tickets:manage'],
    });
    expect(role.status).toBe(201);
    await call(t.ama, 'POST', '/rights/grants', {
      roleId: role.body.roleId,
      personId: personKofi,
      startsOn: '2026-01-01',
    });
    expect((await call(t.kofi, 'GET', '/apps/prd_kete_helpdesk/grants')).body).toEqual({
      managed: true,
      permissions: [
        { permission: 'tickets:read', everywhere: true, units: [] },
        { permission: 'tickets:manage', everywhere: true, units: [] },
      ],
    });
    // Managed now: Esi, granted nothing, holds nothing in the app.
    expect((await call(t.esi, 'GET', '/apps/prd_kete_helpdesk/grants')).body).toEqual({
      managed: true,
      permissions: [],
    });
    // Her own rights screen lists them too.
    const mine = (await call(t.kofi, 'GET', '/rights/me')).body.reaches as Answer[];
    expect(mine.map((r) => r.permission)).toContain('prd_kete_helpdesk#tickets:manage');
  });
});
