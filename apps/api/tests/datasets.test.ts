import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { datasetTools } from '../src/features/datasets/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 031: a team's tables kept as rows, typed, described as the apps' data sets are, read by
// whom its audience opens them to, and summed up by one small query — for the screens and for the
// assistant, whose figures come from the rows.

let db: TestSchema;
const api = createApi();
const t = { admin: '', ama: '', kofi: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `datasets-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const csv = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const sales = csv(
  [
    'Agence;Date;Montant;Clients',
    'Lomé;15/10/2026;1 200,50;3',
    'Kara;20/10/2026;950;2',
    'Lomé;02/11/2026;2 000;5',
    'Sokodé;03/11/2026;400;1',
  ].join('\n'),
);

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin' });
  t.ama = await tokenFor('usr_ama', { name: 'Ama Agbeko' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi Mensah' });
});

afterAll(async () => {
  await db?.drop();
});

describe("a team's data", () => {
  let datasetId = '';

  it('answers only when its module is on', async () => {
    expect((await call(t.ama, 'GET', '/datasets')).body).toMatchObject({
      error: 'module_disabled',
    });
    await call(t.admin, 'POST', '/organization/modules', { module: 'datasets', enabled: true });
  });

  it("keeps a CSV as typed rows, described as the apps' data sets", async () => {
    expect(
      (
        await call(t.ama, 'POST', '/datasets', {
          name: 'X',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          data: csv('x'),
        })
      ).body,
    ).toMatchObject({ error: 'unsupported_file' });
    const created = await call(t.ama, 'POST', '/datasets', {
      name: 'Ventes SAV',
      fileName: 'ventes.csv',
      contentType: 'text/csv',
      data: sales,
    });
    expect(created).toMatchObject({
      status: 201,
      body: {
        dataset: {
          name: 'Ventes SAV',
          rowCount: 4,
          timeColumn: 'Date',
          measures: ['Montant', 'Clients'],
          dimensions: ['Agence'],
          audience: ['user:usr_ama'],
        },
      },
    });
    datasetId = (created.body.dataset as { datasetId: string }).datasetId;
    const read = await call(t.ama, 'GET', `/datasets/${datasetId}`);
    expect((read.body.preview as unknown[])[0]).toEqual({
      Agence: 'Lomé',
      Date: '2026-10-15',
      Montant: 1200.5,
      Clients: 3,
    });
    expect((await call(t.kofi, 'GET', `/datasets/${datasetId}`)).status).toBe(404);
  });

  it('serves its rows dated and limited, and sums them up', async () => {
    const november = await call(
      t.ama,
      'GET',
      `/datasets/${datasetId}/rows?from=2026-11-01&limit=1`,
    );
    expect(november.body).toMatchObject({ rows: [{ Agence: 'Lomé' }], truncated: true });
    const byAgency = await call(t.ama, 'POST', `/datasets/${datasetId}/query`, {
      groupBy: ['Agence'],
      measures: [{ fn: 'sum', column: 'Montant' }, { fn: 'count' }],
    });
    expect(byAgency.body.rows).toEqual([
      { Agence: 'Lomé', 'sum(Montant)': 3200.5, count: 2 },
      { Agence: 'Kara', 'sum(Montant)': 950, count: 1 },
      { Agence: 'Sokodé', 'sum(Montant)': 400, count: 1 },
    ]);
    const filtered = await call(t.ama, 'POST', `/datasets/${datasetId}/query`, {
      filters: [{ column: 'Montant', op: 'gte', value: 900 }],
      measures: [{ fn: 'avg', column: 'Clients' }],
    });
    expect(filtered.body.rows).toEqual([{ 'avg(Clients)': 3.333333 }]);
    expect(
      (
        await call(t.ama, 'POST', `/datasets/${datasetId}/query`, {
          measures: [{ fn: 'sum', column: 'Agence' }],
        })
      ).body,
    ).toMatchObject({ error: 'invalid_query' });
  });

  it('is opened to others by an administrator, never by its owner', async () => {
    expect(
      (await call(t.ama, 'POST', `/datasets/${datasetId}`, { audience: ['everyone'] })).status,
    ).toBe(403);
    await call(t.admin, 'POST', `/datasets/${datasetId}`, { audience: ['everyone'] });
    expect((await call(t.kofi, 'GET', '/datasets')).body.datasets).toHaveLength(1);
    expect(
      (
        await call(t.kofi, 'POST', `/datasets/${datasetId}/rows`, {
          fileName: 'v.csv',
          contentType: 'text/csv',
          data: sales,
        })
      ).status,
    ).toBe(403);
  });

  it('gives the assistant the figures from the rows, never more than she reads', async () => {
    const identity = (userId: string) =>
      ({ organizationId: 'org_kya', userId, name: userId, role: 'member' }) as Parameters<
        typeof datasetTools
      >[0];
    const [list, query] = datasetTools(identity('usr_kofi'));
    expect(await list?.execute({})).toMatchObject({
      status: 'done',
      output: { datasets: [{ datasetId, name: 'Ventes SAV', rows: 4 }] },
    });
    expect(
      await query?.execute({
        datasetId,
        groupBy: ['Agence'],
        measures: [{ fn: 'sum', column: 'Clients' }],
        filters: [{ column: 'Agence', op: 'eq', value: 'lomé' }],
      }),
    ).toMatchObject({ status: 'done', output: { rows: [{ Agence: 'Lomé', 'sum(Clients)': 8 }] } });
    await call(t.admin, 'POST', `/datasets/${datasetId}`, { audience: ['user:usr_ama'] });
    expect(await query?.execute({ datasetId, measures: [{ fn: 'count' }] })).toMatchObject({
      output: { error: 'not_found' },
    });
  });

  it('takes a new version of its table from its owner, and is removed by her', async () => {
    const updated = await call(t.ama, 'POST', `/datasets/${datasetId}/rows`, {
      fileName: 'ventes-2.csv',
      contentType: 'text/csv',
      data: csv('Agence;Montant\nLomé;10\n'),
    });
    expect(updated.body).toMatchObject({
      dataset: { rowCount: 1, timeColumn: null, sourceName: 'ventes-2.csv' },
    });
    expect((await call(t.ama, 'POST', `/datasets/${datasetId}/remove`)).body).toEqual({
      removed: true,
    });
  });
});
