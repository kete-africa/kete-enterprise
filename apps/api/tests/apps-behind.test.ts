import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 070 (doctrine D-042): the center has three places; a business tool is an app, behind it.
// « Apps » lists what stands there for a person — the packs switched on that her rights open —
// with what the center receives from each.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', kofi: '' };
let key = 0;
let positionId = '';

type Entry = {
  kind: string;
  key: string;
  href: string | null;
  external: boolean;
  receives: { waiting: number; tools: number; watch: boolean; reads: string | null };
};
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `behind-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const packsOf = async (token: string) =>
  ((await call(token, 'GET', '/apps')).body.apps as Entry[]).filter(
    (entry) => entry.kind === 'pack',
  );
const turn = (module: string, enabled: boolean) =>
  post(t.admin, '/organization/modules', { module, enabled });

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.awa = await tokenFor('usr_awa', { name: 'Awa Mensah' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Agbo' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId;
  const unit = (
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Qualité',
      startsOn: '2026-01-01',
    })
  ).body.unitId;
  positionId = String(
    (
      await post(t.admin, '/structure/positions', {
        unitId: unit,
        title: 'Responsable qualité',
        startsOn: '2026-01-01',
      })
    ).body.positionId,
  );
  const personId = (
    await post(t.admin, '/structure/people', { name: 'Awa Mensah', accountUserId: 'usr_awa' })
  ).body.personId;
  await post(t.admin, '/structure/assignments', {
    personId,
    positionId,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  for (const module of ['surveys', 'performance', 'meetings', 'compliance']) {
    await turn(module, false);
  }
});

afterAll(async () => {
  await db?.drop();
});

describe('the center has its three places; a business tool is an app behind it', () => {
  it('lists no pack while none is switched on', async () => {
    expect(await packsOf(t.admin)).toEqual([]);
  });

  it('lists the packs switched on, each with where it opens and what the center receives', async () => {
    for (const module of ['performance', 'meetings', 'compliance']) await turn(module, true);
    const packs = await packsOf(t.admin);
    expect(packs.map((pack) => pack.key)).toEqual(['performance', 'meetings', 'compliance']);
    expect(packs.find((pack) => pack.key === 'compliance')).toMatchObject({
      href: '/conformite',
      external: false,
      // An agent may watch the controls and signal what goes wrong.
      receives: { watch: true },
    });
    const performance = packs.find((pack) => pack.key === 'performance');
    // The capabilities agents may call there are counted from the gateway's own list.
    expect(performance?.receives.tools).toBeGreaterThan(0);
    expect(performance?.receives.watch).toBe(false);
  });

  it('shows a person only the packs her rights open', async () => {
    expect(await packsOf(t.awa)).toEqual([]);
    const role = (
      await post(t.admin, '/rights/roles', { name: 'Qualité', permissions: ['compliance:read'] })
    ).body.roleId;
    await post(t.admin, '/rights/grants', { roleId: role, positionId, startsOn: '2026-01-01' });
    expect((await packsOf(t.awa)).map((pack) => pack.key)).toEqual(['compliance']);
    // A colleague without the right sees none of them.
    expect(await packsOf(t.kofi)).toEqual([]);
  });

  it('drops a pack once its module is switched off', async () => {
    await turn('compliance', false);
    expect(await packsOf(t.awa)).toEqual([]);
    expect((await packsOf(t.admin)).map((pack) => pack.key)).toEqual(['performance', 'meetings']);
  });
});
