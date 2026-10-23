import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { toolsForPerson } from '../src/features/gateway/index.js';
import { asPerson } from '../src/platform/acting.js';
import { startApi, tokenFor } from './support.js';

// Spec 103 (kete-core spec 145, ADR 0016; doctrine D-062, R16, R22): views configured where they
// are used. The steering board is Kete's default, built from the organization's indicators and the
// center's sources; the organization and a person make their versions; the most precise wins,
// whole; every version is kept; Kete changes her version on a sentence, and it is undone.

const ORG = 'org_views';
const PLACE = 'board:steering';

let db: TestSchema;
const api = createApi();
const t = { admin: '', kossi: '', essi: '' };
let key = 0;
const ids = {} as Record<'unit', string>;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `view-configs-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const get = (token: string, path: string) => call(token, 'GET', path);
const put = (token: string, path: string, body: object) => call(token, 'PUT', path, body);
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);

type Board = {
  kind: string;
  title: { fr: string; en: string };
  board: { cards: { view: { figure?: { chart: string } } }[] };
};
const shown = async (token: string) => {
  const answer = (await get(token, `/views/${PLACE}`)).body;
  return { level: answer.level as string, view: answer.view as Board };
};
const titled = (fr: string) => ({
  kind: 'board',
  title: { fr, en: fr },
  board: {
    cards: [
      {
        view: {
          kind: 'figure',
          title: { fr: 'Le parc par état', en: 'The fleet by state' },
          source: {
            dataset: 'assets',
            product: 'center',
            group_by: ['state'],
            measures: [{ fn: 'count' }],
          },
          figure: { chart: 'pie' },
        },
        place: { x: 0, y: 0, w: 6, h: 4 },
      },
    ],
  },
});

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi', org: ORG });
  t.essi = await tokenFor('usr_essi', { name: 'Essi', org: ORG });
  const type = String(
    (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body.unitTypeId,
  );
  ids.unit = String(
    (
      await post(t.admin, '/structure/units', {
        unitTypeId: type,
        name: 'Agence Maritime',
        startsOn: '2026-01-01',
      })
    ).body.unitId,
  );
  for (const [name, state] of [
    ['Mini-centrale A', 'in_service'],
    ['Mini-centrale B', 'alert'],
    ['Pompe C', 'in_service'],
  ] as const) {
    const made = await post(t.admin, '/assets', { name, unitId: ids.unit });
    const assetId = (made.body.asset as { assetId: string }).assetId;
    if (state !== 'in_service') await post(t.admin, `/assets/${assetId}`, { state });
  }
});

afterAll(async () => {
  await db?.drop();
});

describe('a place shows a view (FR-001, FR-002)', () => {
  it('is Kete’s steering board by default, built from the center’s sources', async () => {
    const { level, view } = await shown(t.essi);
    expect(level).toBe('app');
    expect(view.title.fr).toBe('Pilotage');
    expect(view.board.cards.map((c) => c.view.figure?.chart)).toEqual(
      expect.arrayContaining(['pie', 'tilemap', 'pareto', 'combo', 'cumulative']),
    );
    // No referential yet: no scorecard of nothing.
    expect(view.board.cards.some((c) => c.view.figure?.chart === 'scorecard')).toBe(false);
  });

  it('reads each card with her rights, naming the units it groups by', async () => {
    const read = async (token: string, group: string) =>
      (
        await post(token, '/views/read', {
          view: {
            kind: 'figure',
            title: { fr: 'x', en: 'x' },
            source: {
              dataset: 'assets',
              product: 'center',
              group_by: [group],
              measures: [{ fn: 'count' }],
            },
            figure: { chart: 'pie' },
          },
        })
      ).body;
    const byState = await read(t.admin, 'state');
    expect(byState).toMatchObject({
      state: 'done',
      provenance: { source: 'Kete · assets', counted: 3 },
    });
    expect(byState.rows).toEqual(
      expect.arrayContaining([
        { state: 'En service', Nombre: 2 },
        { state: 'En alerte', Nombre: 1 },
      ]),
    );
    expect((await read(t.admin, 'unit_id')).rows).toEqual([
      { unit_id: 'Agence Maritime', Nombre: 3 },
    ]);
    // Essi works nowhere and reads no asset: nothing to count, said so.
    expect(await read(t.essi, 'state')).toMatchObject({ state: 'empty' });
  });
});

describe('layers, the most precise winning whole (FR-003, FR-004)', () => {
  it('lets an administrator set the organization’s, never a member', async () => {
    const org = (view: object) => ({ level: 'organization', view });
    expect((await put(t.kossi, `/views/${PLACE}`, org(titled('X')))).status).toBe(403);
    expect((await put(t.admin, `/views/${PLACE}`, org({ kind: 'board' }))).status).toBe(422);
    expect((await put(t.admin, `/views/${PLACE}`, org(titled('Pilotage du groupe')))).status).toBe(
      200,
    );
    expect(await shown(t.essi)).toMatchObject({
      level: 'organization',
      view: { title: { fr: 'Pilotage du groupe' } },
    });
  });

  it('keeps her own version over the organization’s, and every version before', async () => {
    expect((await put(t.kossi, `/views/${PLACE}`, { view: titled('Mon pilotage') })).status).toBe(
      200,
    );
    expect(await shown(t.kossi)).toMatchObject({
      level: 'person',
      view: { title: { fr: 'Mon pilotage' } },
    });
    expect((await shown(t.essi)).level).toBe('organization');
    await put(t.kossi, `/views/${PLACE}`, { view: titled('Mon pilotage, 2') });
    const versions = (await get(t.kossi, `/views/${PLACE}/versions`)).body.versions as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await post(t.kossi, `/views/${PLACE}/restore`, { version: 1 })).status).toBe(200);
    expect((await shown(t.kossi)).view.title.fr).toBe('Mon pilotage');
    expect((await post(t.kossi, `/views/${PLACE}/restore`, { version: null })).status).toBe(200);
    expect((await shown(t.kossi)).level).toBe('organization');
  });
});

describe('Kete changes her view on a sentence (FR-005)', () => {
  it('reads it, writes her version — journaled — and it is undone', async () => {
    const identity = {
      userId: 'usr_essi',
      email: '',
      name: 'Essi',
      organizationId: ORG,
      role: null,
      apps: {},
      twoFactor: false,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const result = await asPerson(identity, async () => {
      const tools = await toolsForPerson(identity);
      const read = tools.find((tool) => tool.name === 'view_read');
      const change = tools.find((tool) => tool.name === 'view_change');
      const before = (await read?.execute({ place: PLACE })) as { output: { view: Board } };
      return change?.execute({
        place: PLACE,
        view: { ...before.output.view, title: { fr: 'Pilotage d’Essi', en: 'Essi’s steering' } },
      });
    });
    expect(result).toMatchObject({ status: 'done' });
    expect(await shown(t.essi)).toMatchObject({
      level: 'person',
      view: { title: { fr: 'Pilotage d’Essi' } },
    });
    const { rows } = await db.owner.query<{ name: string; actor_kind: string }>(
      `select name, actor_kind from ${db.schema}.kete_commands where name = 'set-my-view'`,
    );
    expect(rows).toEqual([{ name: 'set-my-view', actor_kind: 'agent' }]);
    expect((await post(t.essi, `/views/${PLACE}/restore`, { version: null })).status).toBe(200);
    expect((await shown(t.essi)).level).toBe('organization');
  });
});
