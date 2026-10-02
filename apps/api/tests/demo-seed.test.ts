import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as kya from '../db/demo/kya.js';
import { seedDemo } from '../db/demo/seed.js';
import { createApi, permissionCatalog } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 010: the KYA demo profile seeds an empty organization, marks it a demo, and keeps its
// structure on a second run while roles and modules are brought up to date.

let db: TestSchema;
const api = createApi();

beforeAll(async () => {
  db = await startApi();
});

afterAll(async () => {
  await db?.drop();
});

const seed = () =>
  seedDemo({
    app: db.app,
    owner: db.owner,
    schema: db.schema,
    organizationId: 'org_demo',
    permissions: permissionCatalog,
  });

describe('the KYA demo', () => {
  it('seeds the structure, the people and the roles once', async () => {
    const first = await seed();
    expect(first).toMatchObject({
      structure: 'created',
      units: kya.units.length,
      positions: kya.positions.length,
      people: kya.people.length,
      questionnaires: 3,
      profiles: 48,
    });
    const again = await seed();
    expect(again).toMatchObject({
      structure: 'kept',
      units: 0,
      people: 0,
      roles: 0,
      questionnaires: 0,
      profiles: 0,
    });
    // A remote test database answers each of the seed's hundreds of gestures in turn.
  }, 600_000);

  it('gives fictitious e-mails only', () => {
    const emails = kya.people.map((p) => kya.demoEmail(p.name));
    expect(emails.every((e) => /^[a-z.-]+@kya-demo\.test$/.test(e))).toBe(true);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('lets an administrator view the space as a demo person', async () => {
    const admin = await tokenFor('usr_operator', { role: 'admin', org: 'org_demo' });
    const chart = (await (
      await api.request('/v1/structure', { headers: { authorization: `Bearer ${admin}` } })
    ).json()) as { people: { personId: string; name: string }[] };
    const sav = chart.people.find((p) => p.name === 'Abla Nyuiadzi');
    const me = (await (
      await api.request('/v1/me', {
        headers: { authorization: `Bearer ${admin}`, 'kete-view-as': sav?.personId ?? '' },
      })
    ).json()) as Record<string, unknown>;
    expect(me).toMatchObject({ name: 'Abla Nyuiadzi', demo: true, administrator: false });
    expect(me.modules).toMatchObject({ surveys: true, performance: true, meetings: true });
  });
});
