import { answerQuery } from '@kete/metrics';
import type { Dataset } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { quarterSoFar, useMeasureFetch, watchIndicators } from '../src/features/measure/index.js';
import { useCardReader, type IdentityCard } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 102 (kete-core spec 144, ADR 0015; doctrine D-062, R2, R4, R7, R17): the Measure. An
// indicator of the referential names its source — the center's own assets, an app's data set — and
// is read live, with the reader's rights and filters, saying where it comes from. A source that does
// not answer is missing and red, never zero. Turning red for the organization gives its owner a
// holding « action corrective », once; a freeze keeps readings; a review's line takes its value
// from the source, with its proof.

const ORG = 'org_measure';

let db: TestSchema;
const api = createApi();
const t = { admin: '', kossi: '', yao: '', essi: '' };
let key = 0;
const ids = {} as Record<
  'unit' | 'ownerPos' | 'techPos' | 'parc' | 'factures' | 'quarter' | 'review',
  string
>;

const invoices: Dataset = {
  name: 'invoices',
  description: 'Invoices issued.',
  permission: 'finance:read',
  row: {
    type: 'object',
    properties: {
      issued_on: { type: 'string' },
      amount: { type: 'number' },
      unit: { type: 'string' },
    },
  },
  time: 'issued_on',
  axes: { unit: 'unit' },
};
const financeCard = {
  product: 'prd_finance',
  name: 'Kete Finance',
  version: '1.0.0',
  client: 'cli_finance',
  datasets: [invoices],
  endpoints: { api: 'https://finance.example.test/api/v1' },
} as unknown as IdentityCard;
let financeUp = true;
let financeSeen: string | null = null;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `measure-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Answer };
  } catch {
    return { status: response.status, body: { text } as Answer };
  }
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const put = (token: string, path: string, body: object) => call(token, 'PUT', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const id = (answer: { body: Answer }, field: string) => String(answer.body[field] ?? '');

type Reading = {
  indicatorId: string;
  value: number | null;
  status: string;
  colour: string | null;
  provenance: { source: string; filter: Record<string, string>; counted: number | null };
};
const holdingsFor = async (userId: string) =>
  (
    await db.owner.query<{ what: string; source_app: string }>(
      `select what, source_app from ${db.schema}.kete_holdings
        where holder_id = $1 and source_app = 'measure' order by since`,
      [userId],
    )
  ).rows;

const L = (name: string) => ({
  name,
  formula: 'f',
  source: 's',
  frequency: 'Mensuelle',
  targetText: '≥ 97 %',
  thresholdText: '< 90 %',
  direction: 'higher',
  target: 97,
  threshold: 90,
  alertWhen: '<',
  kind: 'scored',
  weight: 0.5,
});

beforeAll(async () => {
  db = await startApi();
  useCardReader(async (address) => (address.includes('finance') ? financeCard : null));
  // Kete Finance, in memory: it sums its invoices up at home and answers only the groups.
  useMeasureFetch((async (url: string, init: RequestInit) => {
    financeSeen = new Headers(init.headers).get('authorization');
    if (!financeUp) return new Response(null, { status: 503 });
    expect(url).toBe('https://finance.example.test/api/v1/datasets/invoices/query');
    const rows = [
      { issued_on: '2026-10-02', amount: 400, unit: 'u1' },
      { issued_on: '2026-10-05', amount: 100, unit: 'u2' },
    ];
    return Response.json(answerQuery(invoices, rows, JSON.parse(String(init.body))));
  }) as unknown as typeof fetch);
  t.admin = await tokenFor('usr_admin', { role: 'admin', name: 'Admin', org: ORG });
  t.kossi = await tokenFor('usr_kossi', { name: 'Kossi Amegah', org: ORG });
  t.yao = await tokenFor('usr_yao', { name: 'Yao Mensah', org: ORG });
  t.essi = await tokenFor('usr_essi', { name: 'Essi Lawson', org: ORG });
  await post(t.admin, '/organization/modules', { module: 'performance', enabled: true });
  expect(
    (
      await post(t.admin, '/registry/resources', {
        kind: 'app',
        name: 'Kete Finance',
        address: 'https://finance.example.test',
      })
    ).status,
  ).toBe(201);
  const type = id(
    await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' }),
    'unitTypeId',
  );
  ids.unit = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'Service après-vente',
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  const position = async (title: string) =>
    id(
      await post(t.admin, '/structure/positions', {
        unitId: ids.unit,
        title,
        startsOn: '2026-01-01',
      }),
      'positionId',
    );
  ids.ownerPos = await position('Responsable SAV');
  ids.techPos = await position('Technicien');
  for (const [name, account, positionId] of [
    ['Kossi Amegah', 'usr_kossi', ids.ownerPos],
    ['Yao Mensah', 'usr_yao', ids.techPos],
  ] as const) {
    const personId = id(
      await post(t.admin, '/structure/people', { name, accountUserId: account }),
      'personId',
    );
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  }
  const roleId = id(
    await post(t.admin, '/rights/roles', {
      name: 'Contrôle',
      permissions: ['performance:measure', 'objects:read'],
    }),
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId,
    positionId: ids.ownerPos,
    startsOn: '2026-01-01',
  });
  // The fleet: three assets in service, one in alert — three of them answered for by Yao.
  for (const [name, state, holder] of [
    ['Mini-centrale A', 'in_service', 'usr_yao'],
    ['Mini-centrale B', 'in_service', 'usr_yao'],
    ['Mini-centrale C', 'alert', 'usr_yao'],
    ['Pompe D', 'in_service', null],
  ] as const) {
    const made = await post(t.admin, '/assets', {
      name,
      unitId: ids.unit,
      ...(holder ? { holderUserId: holder } : {}),
    });
    const assetId = (made.body.asset as { assetId: string }).assetId;
    if (state !== 'in_service') await post(t.admin, `/assets/${assetId}`, { state });
  }
  // The referential: two indicators of the technician's grid.
  expect(
    (
      await post(t.admin, '/performance/referential', {
        source: 'Test',
        profiles: [
          {
            title: 'Technicien',
            category: 'AE',
            direction: null,
            weights: { individual: 1, collective: 0, collectiveLabel: null, group: 0, note: null },
            lines: [L('Disponibilité du parc'), L('Factures émises')],
          },
        ],
      })
    ).status,
  ).toBeLessThan(300);
  const { rows } = await db.owner.query<{ indicator_id: string; name: string }>(
    `select indicator_id, name from ${db.schema}.indicators`,
  );
  ids.parc = rows.find((r) => r.name === 'Disponibilité du parc')?.indicator_id ?? '';
  ids.factures = rows.find((r) => r.name === 'Factures émises')?.indicator_id ?? '';
});

afterAll(async () => {
  useMeasureFetch(undefined);
  await db?.drop();
});

describe('an indicator names its source (FR-001, FR-002)', () => {
  it('lists the center’s sources and the apps’ data sets', async () => {
    const sources = (await get(t.essi, '/measure/sources')).body as {
      center: { name: string; axes: object }[];
      apps: { product: string; datasets: { name: string }[] }[];
    };
    expect(sources.center.map((d) => d.name)).toEqual(['holdings', 'money', 'assets']);
    expect(sources.apps).toEqual([
      expect.objectContaining({
        product: 'prd_finance',
        datasets: [expect.objectContaining({ name: 'invoices' })],
      }),
    ]);
  });

  it('is set by who manages the referential, with a whole rule', async () => {
    const parc = {
      source: {
        kind: 'center',
        dataset: 'assets',
        measure: { fn: 'sum', field: 'in_service' },
        over: { measure: { fn: 'count' } },
      },
      unit: 'percent',
      direction: 'higher',
      target: 97,
      threshold: 90,
      alertWhen: '<',
      ownerPositionId: ids.ownerPos,
    };
    expect((await put(t.essi, `/measure/indicators/${ids.parc}/source`, parc)).status).toBe(403);
    expect(
      (
        await put(t.admin, `/measure/indicators/${ids.parc}/source`, {
          ...parc,
          threshold: undefined,
        })
      ).status,
    ).toBe(422);
    expect((await put(t.admin, `/measure/indicators/${ids.parc}/source`, parc)).status).toBe(200);
    expect(
      (
        await put(t.admin, `/measure/indicators/${ids.factures}/source`, {
          source: {
            kind: 'dataset',
            product: 'prd_finance',
            dataset: 'invoices',
            measure: { fn: 'sum', field: 'amount' },
          },
          unit: 'money',
          direction: 'higher',
          target: 1000,
          threshold: 200,
          alertWhen: '<',
          ownerPositionId: ids.ownerPos,
        })
      ).status,
    ).toBe(200);
  });
});

describe('a reading is live, hers, and says where it comes from (FR-003, FR-004)', () => {
  it('reads with her rights: the organization for the administrator, his unit for Yao', async () => {
    const read = async (token: string, query = '') =>
      (await get(token, `/measure/indicators/${ids.parc}${query}`)).body.reading as Reading;
    const whole = await read(t.admin);
    expect(whole).toMatchObject({ value: 75, status: 'done', colour: 'red' });
    expect(whole.provenance).toMatchObject({ source: 'Kete · assets', counted: 4 });
    // Yao works in the unit: he sees its four assets; filtered on him, his own three.
    expect(await read(t.yao)).toMatchObject({ value: 75, colour: 'red' });
    expect(await read(t.yao, '?person=usr_yao')).toMatchObject({ value: 66.7 });
    // Essi sees no asset: nothing to count for her is no figure and no colour — not a zero.
    expect(await read(t.essi)).toMatchObject({ value: null, status: 'done', colour: null });
    // A filter on an axis the source carries applies, and the reading says so.
    expect((await read(t.admin, `?unit=${ids.unit}`)).provenance.filter).toEqual({
      unit_id: ids.unit,
    });
  });

  it('asks an app with her token, summed up there; silent, it is missing and red', async () => {
    const read = async () =>
      (await get(t.admin, `/measure/indicators/${ids.factures}`)).body.reading as Reading;
    // Below its target, above its threshold: orange.
    expect(await read()).toMatchObject({ value: 500, status: 'done', colour: 'orange' });
    expect(financeSeen).toBe(`Bearer ${t.admin}`);
    financeUp = false;
    expect(await read()).toMatchObject({ value: null, status: 'missing', colour: 'red' });
    financeUp = true;
  });
});

describe('a colour has a consequence (FR-006)', () => {
  it('gives the owner one corrective holding when the organization’s figure turns red', async () => {
    const mine = await holdingsFor('usr_kossi');
    expect(mine.map((h) => h.what)).toEqual([
      expect.stringContaining('« Disponibilité du parc » à 75 %'),
      expect.stringContaining('« Factures émises » sans donnée'),
    ]);
    // Read again, still red: no second holding; the event path said it once each.
    await get(t.admin, `/measure/indicators/${ids.parc}`);
    expect(await holdingsFor('usr_kossi')).toHaveLength(2);
    const { rows } = await db.owner.query<{ n: number }>(
      `select count(*)::int as n from ${db.schema}.kete_events where type = 'indicator.turned_red'`,
    );
    expect(rows[0]?.n).toBe(2);
    // A reader's own sight is not the organization's: Yao's reading changes nothing.
    await get(t.yao, `/measure/indicators/${ids.parc}`);
    expect(await holdingsFor('usr_kossi')).toHaveLength(2);
  });

  it('is watched by the worker for the center’s sources', async () => {
    await db.owner.query(`update ${db.schema}.indicator_colours set colour = 'green'`);
    expect(await watchIndicators()).toBe(1);
    expect(await holdingsFor('usr_kossi')).toHaveLength(3);
  });
});

describe('a freeze, and a review’s line from its source (FR-007, FR-008)', () => {
  it('keeps readings as they were read', async () => {
    const period = quarterSoFar(new Date());
    expect(
      (await post(t.essi, '/measure/freezes', { label: 'T4', indicators: [ids.parc] })).status,
    ).toBe(403);
    const frozen = await post(t.admin, '/measure/freezes', {
      label: 'T4 à date',
      indicators: [ids.parc, ids.factures],
      ...period,
    });
    expect(frozen.status).toBe(201);
    const listed = (await get(t.admin, '/measure/freezes')).body.freezes as {
      label: string;
      readings: Reading[];
    }[];
    expect(listed[0]?.label).toBe('T4 à date');
    expect(listed[0]?.readings.map((r) => r.value)).toEqual([75, 500]);
  });

  it('measures a review’s line from the indicator’s source, for its person, with its proof', async () => {
    const { from } = quarterSoFar(new Date());
    const ends = new Date(from);
    ends.setUTCMonth(ends.getUTCMonth() + 3);
    ends.setUTCDate(0);
    ids.quarter = id(
      await post(t.admin, '/performance/quarters', {
        label: 'Ce trimestre',
        startsOn: from,
        endsOn: ends.toISOString().slice(0, 10),
      }),
      'quarterId',
    );
    await post(t.admin, `/performance/quarters/${ids.quarter}/open`);
    const quarter = (await get(t.admin, `/performance/quarters/${ids.quarter}`)).body as {
      reviews: { reviewId: string; personName: string }[];
    };
    ids.review = quarter.reviews.find((r) => r.personName === 'Yao Mensah')?.reviewId ?? '';
    expect((await post(t.yao, `/measure/reviews/${ids.review}/lines/1`)).status).toBe(403);
    const measured = await post(t.kossi, `/measure/reviews/${ids.review}/lines/1`);
    expect(measured.status).toBe(200);
    const { rows } = await db.owner.query<{ value: string; colour: string; proof: string }>(
      `select value, colour, proof from ${db.schema}.review_lines where review_id = $1 and position = 1`,
      [ids.review],
    );
    expect(rows[0]).toMatchObject({ value: '66.7', colour: 'red' });
    expect(rows[0]?.proof).toContain('Kete · assets · 3 lignes');
  });
});
