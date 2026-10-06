import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { dashboardTools, periodDates } from '../src/features/dashboards/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 033: dashboards over a team's tables and a form's answers — composed by a person or
// proposed by her assistant and kept by her, opened by an administrator, each card read with the
// reader's own rights.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `dashboards-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const csv = (text: string) => Buffer.from(text, 'utf8').toString('base64');

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
  for (const module of ['datasets', 'forms', 'dashboards']) {
    await call(t.admin, 'POST', '/organization/modules', { module, enabled: true });
  }
  const dataset = await call(t.ama, 'POST', '/datasets', {
    name: 'Tickets SAV',
    fileName: 'tickets.csv',
    contentType: 'text/csv',
    data: csv('Agence;Date;Délai\nLomé;01/10/2026;2\nKara;02/10/2026;5\nLomé;03/10/2026;4\n'),
  });
  ids.dataset = (dataset.body.dataset as { datasetId: string }).datasetId;
  const form = await call(t.ama, 'POST', '/forms', {
    name: 'Satisfaction',
    fields: [{ key: 'note', label: 'Note', type: 'number', required: true }],
  });
  ids.form = (form.body.collection as { collectionId: string }).collectionId;
  await call(t.kofi, 'POST', `/forms/${ids.form}/submit`, { values: { note: 4 } });
});

afterAll(async () => {
  await db?.drop();
});

const cards = [
  {
    title: 'Tickets par agence',
    source: { kind: 'dataset', id: '' },
    query: { groupBy: ['Agence'], measures: [{ fn: 'count' }] },
    view: 'bar',
  },
  {
    title: 'Délai moyen (jours)',
    source: { kind: 'dataset', id: '' },
    query: { measures: [{ fn: 'avg', column: 'Délai' }] },
    view: 'number',
  },
  {
    title: 'Satisfaction moyenne',
    source: { kind: 'form', id: '' },
    query: { measures: [{ fn: 'avg', column: 'note' }] },
    view: 'number',
  },
];
const withSources = () =>
  cards.map((c) => ({
    ...c,
    source: { ...c.source, id: c.source.kind === 'dataset' ? ids.dataset : ids.form },
  }));

describe('a dashboard', () => {
  let dashboardId = '';

  it('is composed by a person, each card read from its source', async () => {
    const created = await call(t.ama, 'POST', '/dashboards', {
      name: 'SAV',
      widgets: withSources(),
    });
    expect(created).toMatchObject({ status: 201, body: { dashboard: { status: 'kept' } } });
    dashboardId = (created.body.dashboard as { dashboardId: string }).dashboardId;
    const read = await call(t.ama, 'GET', `/dashboards/${dashboardId}`);
    expect(read.body.cards).toMatchObject([
      {
        title: 'Tickets par agence',
        view: 'bar',
        visible: true,
        source: 'Tickets SAV',
        rows: [
          { Agence: 'Lomé', count: 2 },
          { Agence: 'Kara', count: 1 },
        ],
      },
      {
        title: 'Délai moyen (jours)',
        view: 'number',
        visible: true,
        source: 'Tickets SAV',
        rows: [{ 'avg(Délai)': 3.666667 }],
      },
      {
        title: 'Satisfaction moyenne',
        view: 'number',
        visible: true,
        source: 'Satisfaction',
        rows: [{ 'avg(note)': 4 }],
      },
    ]);
  });

  it('is opened by an administrator, and shows each reader only what she may read', async () => {
    expect((await call(t.kofi, 'GET', `/dashboards/${dashboardId}`)).status).toBe(404);
    expect(
      (await call(t.ama, 'POST', `/dashboards/${dashboardId}`, { audience: ['everyone'] })).status,
    ).toBe(403);
    await call(t.admin, 'POST', `/dashboards/${dashboardId}`, { audience: ['everyone'] });
    const kofi = (await call(t.kofi, 'GET', `/dashboards/${dashboardId}`)).body;
    // The team's table is Ama's alone, the form hers to run: Kofi sees the cards, not the figures.
    expect((kofi.cards as { visible: boolean }[]).map((c) => c.visible)).toEqual([
      false,
      false,
      false,
    ]);
    expect(kofi.manage).toBe(false);
    await call(t.admin, 'POST', `/datasets/${ids.dataset}`, { audience: ['everyone'] });
    const now = (await call(t.kofi, 'GET', `/dashboards/${dashboardId}`)).body;
    expect((now.cards as { visible: boolean }[]).map((c) => c.visible)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('is proposed by her assistant, and stays a proposal until she keeps it', async () => {
    const [propose] = dashboardTools({
      organizationId: 'org_kya',
      userId: 'usr_ama',
      name: 'Ama Agbeko',
      role: 'member',
    } as Parameters<typeof dashboardTools>[0]);
    const proposed = await propose?.execute({ name: 'SAV proposé', widgets: withSources() });
    expect(proposed).toMatchObject({
      status: 'done',
      output: { href: expect.stringMatching(/^\/tableaux-de-bord\/dsh_/) },
    });
    const listed = (await call(t.ama, 'GET', '/dashboards')).body.dashboards as {
      dashboardId: string;
      name: string;
      status: string;
    }[];
    const proposal = listed.find((d) => d.name === 'SAV proposé');
    expect(proposal?.status).toBe('proposed');
    await call(t.ama, 'POST', `/dashboards/${proposal?.dashboardId}`, { keep: true });
    expect((await call(t.ama, 'GET', `/dashboards/${proposal?.dashboardId}`)).body).toMatchObject({
      dashboard: { status: 'kept' },
    });
    expect(await propose?.execute({ name: 'Vide', widgets: [] })).toMatchObject({
      status: 'refused',
    });
  });

  it('is removed by its owner only', async () => {
    expect((await call(t.kofi, 'POST', `/dashboards/${dashboardId}/remove`)).status).toBe(403);
    expect((await call(t.ama, 'POST', `/dashboards/${dashboardId}/remove`)).body).toEqual({
      removed: true,
    });
  });
});

describe('a pinned dashboard (spec 046)', () => {
  it('shows on her « Aujourd’hui » with its figures, hers alone', async () => {
    const created = await call(t.ama, 'POST', '/dashboards', {
      name: 'Épinglé',
      widgets: withSources().slice(0, 1),
    });
    const dashboardId = (created.body.dashboard as { dashboardId: string }).dashboardId;
    expect(
      (await call(t.ama, 'POST', `/dashboards/${dashboardId}/pin`, { pinned: true })).status,
    ).toBe(200);
    expect(
      (await call(t.kofi, 'POST', `/dashboards/${dashboardId}/pin`, { pinned: true })).status,
    ).toBe(404);
    const today = (await call(t.ama, 'GET', '/today')).body as {
      pinned: { dashboard: { dashboardId: string }; cards: { visible: boolean }[] }[];
    };
    expect(today.pinned.map((p) => p.dashboard.dashboardId)).toEqual([dashboardId]);
    expect(today.pinned[0]?.cards[0]?.visible).toBe(true);
    expect(((await call(t.kofi, 'GET', '/today')).body.pinned as unknown[]).length).toBe(0);
    const listed = (await call(t.ama, 'GET', '/dashboards')).body.dashboards as {
      dashboardId: string;
      pinned: boolean;
    }[];
    expect(listed.find((d) => d.dashboardId === dashboardId)?.pinned).toBe(true);
    await call(t.ama, 'POST', `/dashboards/${dashboardId}/pin`, { pinned: false });
    expect(((await call(t.ama, 'GET', '/today')).body.pinned as unknown[]).length).toBe(0);
  });

  it('is pinned by her assistant when she asks it to (spec 048)', async () => {
    const [propose] = dashboardTools({
      organizationId: 'org_kya',
      userId: 'usr_ama',
      name: 'Ama Agbeko',
      role: 'member',
    } as Parameters<typeof dashboardTools>[0]);
    await propose?.execute({ name: 'Vue épinglée', widgets: withSources().slice(1, 2), pin: true });
    const today = (await call(t.ama, 'GET', '/today')).body as {
      pinned: { dashboard: { name: string; status: string } }[];
    };
    expect(today.pinned.map((p) => p.dashboard)).toEqual([
      expect.objectContaining({ name: 'Vue épinglée', status: 'proposed' }),
    ]);
  });
});

type Tools = ReturnType<typeof dashboardTools>;
const toolsOf = (userId: string): Tools =>
  dashboardTools({
    organizationId: 'org_kya',
    userId,
    name: userId,
    role: 'member',
  } as Parameters<typeof dashboardTools>[0]);
const tool = (tools: Tools, name: string) => tools.find((x) => x.name === name);

describe('a dashboard as its reader wants it (spec 050)', () => {
  let id = '';

  it('keeps each card its place, its goal, its threshold — and keeps notes', async () => {
    const [byAgency, delay, satisfaction] = withSources();
    const created = await call(t.ama, 'POST', '/dashboards', {
      name: 'Comité',
      widgets: [
        { ...byAgency, place: { x: 0, y: 0, w: 8, h: 4 } },
        { ...delay, goal: { value: 3, better: 'down' }, threshold: 3.5 },
        { kind: 'note', title: 'Pour le comité', text: 'Lomé manque de techniciens.' },
        satisfaction,
      ],
    });
    expect(created.status).toBe(201);
    id = (created.body.dashboard as { dashboardId: string }).dashboardId;
    const cards = (await call(t.ama, 'GET', `/dashboards/${id}`)).body.cards as Answer[];
    expect(cards[0]).toMatchObject({
      kind: 'data',
      id: expect.stringMatching(/^w[0-9a-z]+$/),
      place: { x: 0, y: 0, w: 8, h: 4 },
    });
    expect(cards[1]).toMatchObject({ goal: { value: 3, better: 'down' }, threshold: 3.5 });
    expect(cards[2]).toMatchObject({ kind: 'note', text: 'Lomé manque de techniciens.' });
  });

  it('dates its cards by the period, and compares them with the period before', async () => {
    expect(periodDates('7d', new Date('2026-10-06T10:00:00Z'))).toEqual({
      now: { from: '2026-09-30', to: '2026-10-06' },
      before: { from: '2026-09-23', to: '2026-09-29' },
    });
    expect(periodDates('all')).toBeNull();
    const read = await call(t.ama, 'GET', `/dashboards/${id}?period=30d&compare=1`);
    expect(read.body.board).toEqual({ period: '30d', compare: true, filter: null });
    const first = (read.body.cards as { visible: boolean; previous: unknown }[])[0];
    expect(first?.visible).toBe(true);
    expect(Array.isArray(first?.previous)).toBe(true);
  });

  it('narrows the cards whose source has the filter’s column, and says which', async () => {
    const read = await call(
      t.ama,
      'GET',
      `/dashboards/${id}?filter=${encodeURIComponent('Agence:Lomé')}`,
    );
    const [byAgency, delay, , satisfaction] = read.body.cards as Answer[];
    expect(byAgency).toMatchObject({ filtered: true, rows: [{ Agence: 'Lomé', count: 2 }] });
    expect(delay).toMatchObject({ filtered: true, rows: [{ 'avg(Délai)': 3 }] });
    expect(satisfaction).toMatchObject({ visible: true, filtered: false });
  });

  it('keeps the state before each change, and restores one', async () => {
    await call(t.ama, 'POST', `/dashboards/${id}`, { name: 'Comité du lundi' });
    const versions = (await call(t.ama, 'GET', `/dashboards/${id}/versions`)).body.versions as {
      version: number;
      name: string;
      cardCount: number;
    }[];
    expect(versions).toEqual([
      expect.objectContaining({ version: 1, name: 'Comité', cardCount: 4 }),
    ]);
    expect((await call(t.kofi, 'GET', `/dashboards/${id}/versions`)).status).toBe(404);
    const restored = await call(t.ama, 'POST', `/dashboards/${id}/versions/1/restore`);
    expect(restored.body.dashboard).toMatchObject({ name: 'Comité' });
    expect(
      ((await call(t.ama, 'GET', `/dashboards/${id}/versions`)).body.versions as unknown[]).length,
    ).toBe(2);
  });

  it('is made her own by a reader, the original unchanged', async () => {
    await call(t.admin, 'POST', `/dashboards/${id}`, { audience: ['everyone'] });
    const fork = await call(t.kofi, 'POST', `/dashboards/${id}/fork`, { name: 'Ma version' });
    expect(fork).toMatchObject({
      status: 201,
      body: { dashboard: { name: 'Ma version', ownerId: 'usr_kofi', forkedFrom: id } },
    });
    const forkId = (fork.body.dashboard as { dashboardId: string }).dashboardId;
    expect((await call(t.kofi, 'POST', `/dashboards/${forkId}`, { name: 'À moi' })).status).toBe(
      200,
    );
    expect((await call(t.ama, 'GET', `/dashboards/${id}`)).body.dashboard).toMatchObject({
      name: 'Comité',
    });
    expect((await call(t.ama, 'GET', `/dashboards/${forkId}`)).status).toBe(404);
  });

  it('is changed by her assistant, added cards proposed — never someone else’s', async () => {
    const tools = toolsOf('usr_ama');
    const seen = (await tool(tools, 'dashboard_read')?.execute({ dashboardId: id })) as {
      output: { cards: { id: string; title: string }[] };
    };
    const [, delay, note] = seen.output.cards;
    const done = await tool(tools, 'dashboard_change')?.execute({
      dashboardId: id,
      add: [{ kind: 'note', title: 'Pièces', text: '3 références en rupture.' }],
      change: [{ id: delay?.id, view: 'table', threshold: null }],
      remove: [note?.id],
    });
    expect(done).toMatchObject({ status: 'done', output: { added: 1, removed: 1, changed: 1 } });
    const after = (await call(t.ama, 'GET', `/dashboards/${id}`)).body.cards as Answer[];
    expect(after.map((c) => c.title)).toEqual([
      'Tickets par agence',
      'Délai moyen (jours)',
      'Satisfaction moyenne',
      'Pièces',
    ]);
    expect(after[1]).toMatchObject({ view: 'table', threshold: null });
    expect(after[3]).toMatchObject({ kind: 'note', proposed: true });
    expect(
      await tool(toolsOf('usr_kofi'), 'dashboard_change')?.execute({
        dashboardId: id,
        name: 'Pris',
      }),
    ).toMatchObject({ status: 'refused' });
    // Her change is a version: « Annuler » brings the note back.
    const latest = (
      (await call(t.ama, 'GET', `/dashboards/${id}/versions`)).body.versions as {
        version: number;
      }[]
    )[0];
    await call(t.ama, 'POST', `/dashboards/${id}/versions/${latest?.version}/restore`);
    const back = (await call(t.ama, 'GET', `/dashboards/${id}`)).body.cards as Answer[];
    expect(back.map((c) => c.title)).toContain('Pour le comité');
  });
});
