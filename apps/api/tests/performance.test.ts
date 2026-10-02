import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { startApi, tokenFor } from './support.js';

// Spec 012: a quarter from the referential to the factors — grids frozen and notified, measures
// with their proof, the arrêté, the record signed by the manager then by the person through her
// link, HR's validation, and the fallback for a review never held.

let db: TestSchema;
const api = createApi();
const t = { admin: '', hr: '', cg: '', chef: '', dg: '', other: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      'idempotency-key': `performance-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) =>
  call(token, 'POST', `/v1${path}`, body);
const get = (token: string, path: string) => call(token, 'GET', `/v1${path}`);
const id = (answer: { body: Answer }, field: string) => String(answer.body[field] ?? '');

async function linkOf(recipient: string): Promise<string> {
  const { rows } = await db.owner.query<{ html: string }>(
    `select html from ${db.schema}.mail_messages where recipient = $1 order by created_at desc limit 1`,
    [recipient],
  );
  return /\/lien\/([A-Za-z0-9_-]{43})"/.exec(rows[0]?.html ?? '')?.[1] ?? '';
}

const L = (over: object) => ({
  formula: 'f',
  source: 's',
  frequency: 'Mensuelle',
  targetText: '≥ 95 %',
  thresholdText: '< 80 %',
  direction: 'higher',
  target: 95,
  threshold: 80,
  alertWhen: '<',
  kind: 'scored',
  ...over,
});

const referential = {
  source: 'Test',
  profiles: [
    {
      title: 'Technicien',
      category: 'AE',
      direction: 'Direction Technique',
      weights: {
        individual: 0.7,
        collective: 0.2,
        collectiveLabel: 'Équipe',
        group: 0.1,
        note: null,
      },
      lines: [
        L({ name: 'Interventions dans les délais', weight: 0.4 }),
        L({
          name: 'Délai moyen de rétablissement',
          weight: 0.3,
          direction: 'lower',
          target: 24,
          threshold: 48,
          alertWhen: '>',
          targetText: '≤ 24 h',
          thresholdText: '> 48 h',
        }),
        L({
          name: 'Qualité des rapports',
          weight: 0.2,
          direction: null,
          target: null,
          threshold: null,
          alertWhen: null,
          targetText: 'Aucune reprise',
          thresholdText: 'Une reprise',
        }),
        L({
          name: 'Séances de brainstorming',
          weight: 0.1,
          target: 1,
          threshold: 0,
          alertWhen: '<=',
        }),
        L({
          name: 'Accidents',
          weight: null,
          kind: 'malus',
          direction: 'lower',
          target: 0,
          threshold: 1,
          alertWhen: '>=',
          malus: [
            { upTo: 0, coefficient: 1 },
            { upTo: 1, coefficient: 0.5 },
            { upTo: null, coefficient: 0 },
          ],
        }),
      ],
    },
    {
      title: 'Chef IT',
      category: 'C',
      direction: 'DG',
      weights: { individual: 0.55, collective: 0, collectiveLabel: null, group: 0.45, note: null },
      lines: [
        L({ name: 'Mises en production tenues', weight: 0.6 }),
        L({ name: 'Disponibilité', weight: 0.4 }),
      ],
    },
    {
      title: 'Profil faux',
      category: 'C',
      direction: null,
      weights: { individual: 1, collective: 0, collectiveLabel: null, group: 0, note: null },
      lines: [L({ name: 'Seul', weight: 0.5 })],
    },
  ],
};

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  for (const who of ['hr', 'cg', 'chef', 'dg', 'other'] as const)
    t[who] = await tokenFor(`usr_${who}`);
  await post(t.admin, '/organization/modules', { module: 'performance', enabled: true });
  const type = id(
    await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' }),
    'unitTypeId',
  );
  ids.top = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'KYA',
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  ids.it = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'IT',
      parentId: ids.top,
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  const position = async (unitId: string, title: string, reportsTo?: string) =>
    id(
      await post(t.admin, '/structure/positions', {
        unitId,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      }),
      'positionId',
    );
  ids.dgPos = await position(ids.top ?? '', 'Directeur Général');
  ids.hrPos = await position(ids.top ?? '', 'DRH', ids.dgPos);
  ids.cgPos = await position(ids.top ?? '', 'Contrôleur de gestion', ids.dgPos);
  ids.chefPos = await position(ids.it ?? '', 'Chef IT', ids.dgPos);
  ids.techPos = await position(ids.it ?? '', 'Technicien', ids.chefPos);
  const person = async (name: string, positionId: string, extra: object) => {
    const personId = id(await post(t.admin, '/structure/people', { name, ...extra }), 'personId');
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    return personId;
  };
  ids.dg = await person('Yaw', ids.dgPos ?? '', { accountUserId: 'usr_dg' });
  ids.hr = await person('Esi', ids.hrPos ?? '', {
    accountUserId: 'usr_hr',
    email: 'esi@kya-demo.test',
  });
  ids.cg = await person('Afi', ids.cgPos ?? '', { accountUserId: 'usr_cg' });
  ids.chef = await person('Kofi', ids.chefPos ?? '', {
    accountUserId: 'usr_chef',
    email: 'kofi@kya-demo.test',
  });
  ids.tech = await person('Awa', ids.techPos ?? '', { email: 'awa@kya-demo.test' });
  const role = async (name: string, permissions: string[], positionId: string) => {
    const roleId = id(await post(t.admin, '/rights/roles', { name, permissions }), 'roleId');
    await post(t.admin, '/rights/grants', { roleId, positionId, startsOn: '2026-01-01' });
  };
  await role('RH', ['performance:manage', 'performance:validate'], ids.hrPos ?? '');
  await role('CG', ['performance:measure'], ids.cgPos ?? '');
});

afterAll(async () => {
  await db?.drop();
});

describe('a quarter', () => {
  it('imports the referential, refusing a grid that is not 100 %, and matches positions by title', async () => {
    expect((await post(t.other, '/performance/referential', referential)).status).toBe(403);
    const imported = await post(t.hr, '/performance/referential', referential);
    expect(imported.body).toMatchObject({ profiles: 2, refused: ['Profil faux'], matched: 2 });
  });

  it('opens: each holder gets her frozen grid, notified by e-mail with her link', async () => {
    ids.quarter = id(
      await post(t.hr, '/performance/quarters', {
        label: 'T3 2026',
        startsOn: '2026-07-01',
        endsOn: '2026-09-30',
      }),
      'quarterId',
    );
    expect((await post(t.hr, `/performance/quarters/${ids.quarter}/open`)).body).toMatchObject({
      reviews: 2,
      sent: 2,
    });
    const quarter = (await get(t.cg, `/performance/quarters/${ids.quarter}`)).body as {
      reviews: { reviewId: string; personName: string; managerName: string | null }[];
    };
    const tech = quarter.reviews.find((r) => r.personName === 'Awa');
    expect(tech?.managerName).toBe('Kofi');
    ids.techReview = tech?.reviewId ?? '';
    ids.chefReview = quarter.reviews.find((r) => r.personName === 'Kofi')?.reviewId ?? '';
    // The technician acknowledges her grid through her link.
    const token = await linkOf('awa@kya-demo.test');
    const seen = await call('', 'GET', `/public/performance/${token}`);
    expect((seen.body.review as { lines: unknown[] }).lines).toHaveLength(5);
    expect((await call('', 'POST', `/public/performance/${token}/acknowledge`)).status).toBe(201);
  });

  it('takes the measures with their proof, and computes colours as it goes', async () => {
    expect(
      (
        await post(t.chef, `/performance/reviews/${ids.techReview}/measures`, {
          lines: [{ position: 1, value: 97 }],
        })
      ).status,
    ).toBe(403);
    const measured = await post(t.cg, `/performance/reviews/${ids.techReview}/measures`, {
      lines: [
        { position: 1, value: 97, proof: 'Registre des interventions' },
        { position: 2, value: 30, proof: 'Outil de tickets' },
        { position: 3, value: 1, colour: 'orange', proof: 'Une reprise demandée' },
        { position: 5, value: 0, proof: 'Registre des accidents' },
      ],
    });
    expect(measured.status).toBe(201);
    await post(t.cg, `/performance/quarters/${ids.quarter}/units/${ids.it}`, { factor: 0.8 });
    await post(t.cg, `/performance/quarters/${ids.quarter}/group`, {
      factor: 0.9,
      triggered: true,
    });
    const closed = await post(t.cg, `/performance/quarters/${ids.quarter}/close-measures`);
    // The brainstorming line had no value: red, charged to the management. Kofi's two lines too.
    expect(closed.body).toMatchObject({ reviews: 2, missing: 3 });
    const review = (await get(t.cg, `/performance/reviews/${ids.techReview}`)).body.review as {
      lines: { colour: string }[];
      individual: number;
      factor: number;
    };
    expect(review.lines.map((l) => l.colour)).toEqual(['green', 'orange', 'orange', 'red', null]);
    // (0.4 × 1 + 0.3 × 0.6 + 0.2 × 0.6 + 0.1 × 0) = 0.70; 0.7 × 0.70 + 0.2 × 0.8 + 0.1 × 0.9.
    expect(review).toMatchObject({ individual: 0.7, factor: 0.74 });
  });

  it('is written and signed by the manager, then signed by the person through her link', async () => {
    expect((await post(t.other, `/performance/reviews/${ids.techReview}/sign`)).status).toBe(403);
    await post(t.chef, `/performance/reviews/${ids.techReview}/record`, {
      facts: 'Bon trimestre sur le terrain.',
      difficulties: 'Pièces en retard.',
      support: 'Stock tampon.',
      protocols: 90,
    });
    expect((await post(t.chef, `/performance/reviews/${ids.techReview}/sign`)).body).toMatchObject({
      status: 'manager_signed',
    });
    // HR cannot validate before the person signs.
    expect((await post(t.hr, `/performance/reviews/${ids.techReview}/validate`)).body.error).toBe(
      'wrong_step',
    );
    const token = await linkOf('awa@kya-demo.test');
    const signed = await call('', 'POST', `/public/performance/${token}/sign`, {
      observations: "D'accord.",
    });
    expect(signed.body).toMatchObject({ status: 'signed' });
  });

  it('is validated by HR, and a review never held falls back', async () => {
    const validated = await post(t.hr, `/performance/reviews/${ids.techReview}/validate`);
    expect(validated.body).toMatchObject({ factor: 0.74 });
    expect((await post(t.hr, `/performance/quarters/${ids.quarter}/close`)).body).toMatchObject({
      missed: 1,
    });
    const chef = (await get(t.chef, `/performance/reviews/${ids.chefReview}`)).body.review as {
      status: string;
      fallback: boolean;
    };
    expect(chef).toMatchObject({ status: 'missed', fallback: true });
  });

  it('shows each person her reviews, and her manager her team', async () => {
    const mine = (await get(t.chef, '/performance/mine')).body as {
      reviews: unknown[];
      team: { personName: string }[];
    };
    expect(mine.reviews).toHaveLength(1);
    expect(mine.team.map((r) => r.personName)).toEqual(['Awa']);
    expect((await get(t.other, `/performance/reviews/${ids.techReview}`)).status).toBe(403);
  });
});
