import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { dashboardTools } from '../src/features/dashboards/index.js';
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
    expect(read.body.cards).toEqual([
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
