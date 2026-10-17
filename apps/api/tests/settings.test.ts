import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { createAccountSettings } from '@kete/settings';
import { settingsIn, useAccountSettings } from '../src/features/settings/index.js';
import { transaction } from '../src/platform/db.js';
import { startApi, tokenFor } from './support.js';

// Spec 092: Kete's settings in the center — the organization's for Kete Enterprise, and each
// unit's (a subsidiary, a site), more precise: KYA Ghana bills in cedis, the group in F CFA.

let db: TestSchema;
const api = createApi();
const t = { admin: '', kossi: '' };
const units = { group: '', ghana: '', accra: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `settings-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);

type View = { key: string; value: unknown; from: string };
const valueOf = (answer: { body: Answer }, name: string) =>
  (answer.body.settings as View[]).find((view) => view.key === name);

// The Compte Kete, as this center reaches it: the organization's layer, Kossi's preferences.
const compte = { person: {} as Record<string, unknown>, saved: [] as unknown[] };

beforeAll(async () => {
  useAccountSettings(
    createAccountSettings({
      url: 'https://compte.kete.test',
      fetch: (async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          const change = JSON.parse(String(init.body)) as { key: string; value: unknown };
          compte.saved.push(change);
          compte.person = { ...compte.person, [change.key]: change.value };
          return Response.json({ person: compte.person });
        }
        return Response.json({
          organizationId: 'org_kya',
          organization: { 'kete.company_name': 'KYA-Energy Group' },
          person: compte.person,
        });
      }) as unknown as typeof fetch,
    }),
  );
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah' });
  const type = async (key: string, legalEntity = false) =>
    (await post(t.admin, '/structure/unit-types', { key, name: key, legalEntity })).body
      .unitTypeId as string;
  const unit = async (unitTypeId: string, name: string, parentId?: string) =>
    (
      await post(t.admin, '/structure/units', {
        unitTypeId,
        name,
        startsOn: '2026-01-01',
        ...(parentId ? { parentId } : {}),
      })
    ).body.unitId as string;
  units.group = await unit(await type('group'), 'KYA Group');
  units.ghana = await unit(await type('legal_entity', true), 'KYA Ghana', units.group);
  units.accra = await unit(await type('site'), 'Accra', units.ghana);
});

afterAll(async () => {
  await db?.drop();
});

describe('the settings of the center', () => {
  it('say each value and where it comes from; Kete’s default first', async () => {
    const answer = await get(t.kossi, '/settings');
    expect(answer.status).toBe(200);
    expect(valueOf(answer, 'kete.currency')).toMatchObject({ value: 'XOF', from: 'kete' });
    expect(valueOf(answer, 'kete.company_name')).toMatchObject({
      value: 'KYA-Energy Group',
      from: 'organization',
    });
    expect(answer.body).toMatchObject({ personal: true, administrator: false });
  });

  it('are set by an administrator, for the center or a unit, and a unit wins below it', async () => {
    expect(
      (await post(t.kossi, '/settings', { key: 'kete.currency', layer: 'app', value: 'EUR' }))
        .status,
    ).toBe(403);
    expect(
      (await post(t.admin, '/settings', { key: 'kete.currency', layer: 'app', value: 'euros' }))
        .status,
    ).toBe(422);
    expect(
      (
        await post(t.admin, '/settings', {
          key: 'kete.currency',
          layer: 'entity',
          unitId: units.ghana,
          value: 'GHS',
        })
      ).status,
    ).toBe(200);
    // At the site of Accra, under KYA Ghana: the entity's currency.
    const accra = await get(t.admin, `/settings?unitId=${units.accra}`);
    expect(valueOf(accra, 'kete.currency')).toMatchObject({ value: 'GHS', from: 'entity' });
    // A member does not read a unit's settings.
    expect((await get(t.kossi, `/settings?unitId=${units.accra}`)).status).toBe(403);
    // Where a command runs at the site: the same.
    const here = await transaction('org_kya', (tx) => settingsIn(tx, 'org_kya', units.accra));
    expect(here.value('kete.currency')).toBe('GHS');
    const group = await transaction('org_kya', (tx) => settingsIn(tx, 'org_kya', units.group));
    expect(group.value('kete.currency')).toBe('XOF');
    // Taken back, KYA Ghana inherits again.
    expect(
      (
        await post(t.admin, '/settings/clear', {
          key: 'kete.currency',
          layer: 'entity',
          unitId: units.ghana,
        })
      ).status,
    ).toBe(200);
    const after = await get(t.admin, `/settings?unitId=${units.accra}`);
    expect(valueOf(after, 'kete.currency')).toMatchObject({ value: 'XOF', from: 'kete' });
  });

  it('keep her preferences in the Compte Kete, where they follow her', async () => {
    const saved = await post(t.kossi, '/settings', {
      key: 'kete.theme',
      layer: 'person',
      value: 'dark',
    });
    expect(saved.status).toBe(200);
    expect(compte.saved).toEqual([{ key: 'kete.theme', value: 'dark' }]);
    const mine = await get(t.kossi, '/settings');
    expect(valueOf(mine, 'kete.theme')).toMatchObject({ value: 'dark', from: 'person' });
  });
});
