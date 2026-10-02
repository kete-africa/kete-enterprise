import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 015: a connected app sends readings of an indicator for a quarter, with their proof;
// management control takes one into a review — the reading is a source, never a measure by itself.

let db: TestSchema;
const api = createApi();
const t = { admin: '', chef: '', cg: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `readings-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string) => call(token, 'GET', path);
const id = (answer: { body: Answer }, field: string) => String(answer.body[field] ?? '');

const sla = "Respect du délai d'intervention (SLA)";

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  t.chef = await tokenFor('usr_chef');
  t.cg = await tokenFor('usr_cg');
  await post(t.admin, '/organization/modules', { module: 'performance', enabled: true });
  const type = id(
    await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' }),
    'unitTypeId',
  );
  ids.sav = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'SAV',
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  const position = async (title: string) =>
    id(
      await post(t.admin, '/structure/positions', {
        unitId: ids.sav,
        title,
        startsOn: '2026-01-01',
      }),
      'positionId',
    );
  const chefPos = await position("Chef d'équipe SAV");
  const cgPos = await position('Contrôleur de gestion');
  for (const [name, pos, account] of [
    ['Koffi', chefPos, 'usr_chef'],
    ['Afi', cgPos, 'usr_cg'],
  ] as const) {
    const personId = id(
      await post(t.admin, '/structure/people', { name, accountUserId: account }),
      'personId',
    );
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId: pos,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
  }
  const role = id(
    await post(t.admin, '/rights/roles', { name: 'CG', permissions: ['performance:measure'] }),
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: cgPos,
    startsOn: '2026-01-01',
  });
  await post(t.admin, '/performance/referential', {
    profiles: [
      {
        title: "Chef d'équipe SAV",
        weights: {
          individual: 0.6,
          collective: 0.25,
          collectiveLabel: 'Direction',
          group: 0.15,
          note: null,
        },
        lines: [
          {
            name: sla,
            weight: 1,
            direction: 'higher',
            target: 95,
            threshold: 90,
            alertWhen: '<',
            targetText: '≥ 95 %',
            thresholdText: '< 90 %',
          },
        ],
      },
    ],
  });
  ids.quarter = id(
    await post(t.admin, '/performance/quarters', {
      label: 'T4 2026',
      startsOn: '2026-10-01',
      endsOn: '2026-12-31',
    }),
    'quarterId',
  );
  await post(t.admin, `/performance/quarters/${ids.quarter}/open`);
});

afterAll(async () => {
  await db?.drop();
});

describe('readings from a connected app', () => {
  it('are accepted for a known indicator, from anyone of the organization', async () => {
    expect(
      (
        await post(t.chef, '/performance/readings', {
          quarter: 'T4 2026',
          indicator: 'Inconnu',
          value: 1,
          proof: 'x',
          source: 'kete-helpdesk',
        })
      ).body.error,
    ).toBe('unknown_indicator');
    const sent = await post(t.chef, '/performance/readings', {
      quarter: 'T4 2026',
      indicator: sla,
      unitId: ids.sav,
      value: 92.5,
      proof: '37 tickets rétablis, 34 dans le délai de leur criticité',
      source: 'kete-helpdesk',
    });
    expect(sent.status).toBe(201);
    ids.reading = id(sent, 'readingId');
    // Only those who measure, run or read the quarters list them.
    expect((await get(t.chef, '/performance/readings?quarter=T4%202026')).status).toBe(403);
  });

  it('become a measure only when management control takes one', async () => {
    const readings = (await get(t.cg, '/performance/readings?quarter=T4%202026')).body.readings as {
      readingId: string;
    }[];
    expect(readings.map((r) => r.readingId)).toEqual([ids.reading]);
    const quarter = (await get(t.cg, `/performance/quarters/${ids.quarter}`)).body as {
      reviews: { reviewId: string }[];
    };
    const reviewId = quarter.reviews[0]?.reviewId ?? '';
    expect(
      (
        await post(t.chef, `/performance/reviews/${reviewId}/from-reading`, {
          position: 1,
          readingId: ids.reading,
        })
      ).status,
    ).toBe(403);
    const taken = await post(t.cg, `/performance/reviews/${reviewId}/from-reading`, {
      position: 1,
      readingId: ids.reading,
    });
    expect(taken.body).toMatchObject({ value: 92.5 });
    const review = (await get(t.cg, `/performance/reviews/${reviewId}`)).body.review as {
      lines: { colour: string; proof: string }[];
    };
    expect(review.lines[0]).toMatchObject({
      colour: 'orange',
      proof: 'kete-helpdesk — 37 tickets rétablis, 34 dans le délai de leur criticité',
    });
  });
});
