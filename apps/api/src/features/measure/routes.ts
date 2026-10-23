import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { findReview, listQuarters, recordMeasure } from '../performance/index.js';
import { isAdministrator, reach, reachesAnything } from '../rights/index.js';
import { freezeReadings, MeasureRefusal, setIndicatorSource } from './commands.js';
import { considerColour } from './consequence.js';
import {
  findIndicator,
  listIndicators,
  readIndicator,
  sourcesFor,
  type Indicator,
  type Reading,
  type ReadingContext,
  type ReadingFilter,
} from './measure.js';
import { measureWords } from './words.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

const day = /^\d{4}-\d{2}-\d{2}$/;
const ids = {
  project_id: /^prj_[0-9a-f-]{8,64}$/,
  party_id: /^pty_[0-9a-f-]{8,64}$/,
  unit_id: /^unt_[0-9a-f-]{8,64}$/,
  person_id: /^[A-Za-z0-9_-]{1,100}$/,
};

/** The filters and the period a reader asks, from a query string or a body; the rest ignored. */
function askedOf(v: Record<string, unknown>) {
  const filter: ReadingFilter = {};
  for (const [key, pattern] of Object.entries(ids) as [keyof ReadingFilter, RegExp][]) {
    const value = v[key] ?? v[key.replace('_id', '')];
    if (typeof value === 'string' && pattern.test(value)) filter[key] = value;
  }
  const from = typeof v.from === 'string' && day.test(v.from) ? v.from : null;
  const to = typeof v.to === 'string' && day.test(v.to) ? v.to : null;
  return { filter, period: from && to && from <= to ? { from, to } : null };
}

const bearer = (c: Ctx) => /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? null;

async function manages(c: Ctx, db: SqlExecutor): Promise<boolean> {
  const identity = c.get('identity');
  return (
    isAdministrator(identity) || reachesAnything(await reach(db, identity, 'performance:manage'))
  );
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof MeasureRefusal) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 422, error.code, error.message);
    }
    throw error;
  }
}

/**
 * Reads indicators for her, in her organization's transaction. Read by an administrator for the
 * whole organization, a colour has its consequence (FR-006).
 */
async function readFor(
  c: Ctx,
  db: SqlExecutor,
  indicators: Indicator[],
  asked: ReturnType<typeof askedOf>,
): Promise<Reading[]> {
  const identity = c.get('identity');
  const context: ReadingContext = { db, identity, token: bearer(c) };
  const readings: Reading[] = [];
  for (const indicator of indicators) {
    const reading = await readIndicator(context, indicator, asked);
    if (isAdministrator(identity)) {
      await considerColour(db, identity.organizationId, indicator, reading);
    }
    readings.push(reading);
  }
  return readings;
}

/** The Measure, under /v1/measure (spec 102). */
export const measureRoutes = new Hono<{ Variables: IdentityVariables }>()
  // What can be measured: the center's sources and the apps' data sets and figures.
  .get('/sources', async (c: Ctx) => {
    const { organizationId } = c.get('identity');
    return c.json(await transaction(organizationId, (db) => sourcesFor(db)));
  })
  // The organization's indicators, each read live for her, with the filters she asks.
  .get('/indicators', async (c: Ctx) => {
    const identity = c.get('identity');
    const asked = askedOf(c.req.query());
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const indicators = await listIndicators(db);
        return {
          indicators,
          readings: await readFor(c, db, indicators, asked),
          manages: await manages(c, db),
        };
      }),
    );
  })
  // Some indicators, read at once: a board's cards (FR-005).
  .post('/readings', async (c: Ctx) => {
    const identity = c.get('identity');
    const body = (await bodyOf(c)) as Record<string, unknown>;
    const wanted = Array.isArray(body.indicators)
      ? body.indicators.filter((v): v is string => typeof v === 'string').slice(0, 50)
      : [];
    const asked = askedOf(body);
    return c.json({
      readings: await transaction(identity.organizationId, async (db) => {
        const all = await listIndicators(db);
        return readFor(
          c,
          db,
          all.filter((i) => wanted.includes(i.indicatorId)),
          asked,
        );
      }),
    });
  })
  .get('/indicators/:id', async (c: Ctx) => {
    const identity = c.get('identity');
    const asked = askedOf(c.req.query());
    const answer = await transaction(identity.organizationId, async (db) => {
      const indicator = await findIndicator(db, c.req.param('id') ?? '');
      if (!indicator) return null;
      const [reading] = await readFor(c, db, [indicator], asked);
      return { indicator, reading };
    });
    if (!answer) throw new GestureRefusal(404, 'not_found', 'No such indicator.');
    return c.json(answer);
  })
  // Its source and rule: who manages the referential (FR-002).
  .put('/indicators/:id/source', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!(await transaction(identity.organizationId, (db) => manages(c, db)))) {
      throw new GestureRefusal(403, 'forbidden', 'This needs performance:manage.');
    }
    const body = (await bodyOf(c)) as object;
    return c.json(
      await run(c, setIndicatorSource, { ...body, indicatorId: c.req.param('id') ?? '' }),
    );
  })
  // Readings frozen as they are read now: a board's summary, a quarter's « arrêté » (FR-007).
  .post('/freezes', async (c: Ctx) => {
    const identity = c.get('identity');
    const body = (await bodyOf(c)) as Record<string, unknown>;
    const label = typeof body.label === 'string' ? body.label : '';
    const wanted = Array.isArray(body.indicators)
      ? body.indicators.filter((v): v is string => typeof v === 'string').slice(0, 100)
      : [];
    const asked = askedOf(body);
    const readings = await transaction(identity.organizationId, async (db) => {
      if (!(await manages(c, db))) {
        throw new GestureRefusal(403, 'forbidden', 'This needs performance:manage.');
      }
      const all = await listIndicators(db);
      return readFor(
        c,
        db,
        all.filter((i) => wanted.includes(i.indicatorId)),
        asked,
      );
    });
    return c.json(
      await run(c, freezeReadings, {
        label,
        period: asked.period,
        filter: asked.filter,
        readings,
        frozenBy: identity.userId,
      }),
      201,
    );
  })
  .get('/freezes', async (c: Ctx) => {
    const identity = c.get('identity');
    const { rows } = await transaction(identity.organizationId, (db) =>
      db.query<{
        freeze_id: string;
        label: string;
        period_from: string | null;
        period_to: string | null;
        filter: ReadingFilter;
        readings: Reading[];
        frozen_by: string;
        frozen_at: Date;
      }>(
        `select freeze_id, label, to_char(period_from, 'YYYY-MM-DD') as period_from,
                to_char(period_to, 'YYYY-MM-DD') as period_to, filter, readings, frozen_by,
                frozen_at
           from measure_freezes order by frozen_at desc limit 50`,
      ),
    );
    return c.json({
      freezes: rows.map((r) => ({
        freezeId: r.freeze_id,
        label: r.label,
        period: r.period_from && r.period_to ? { from: r.period_from, to: r.period_to } : null,
        filter: r.filter,
        readings: r.readings,
        frozenBy: r.frozen_by,
        frozenAt: r.frozen_at.toISOString(),
      })),
    });
  })
  // A review's line, measured from its indicator's source over the quarter (FR-008).
  .post('/reviews/:reviewId/lines/:position', async (c: Ctx) => {
    const identity = c.get('identity');
    const reviewId = c.req.param('reviewId') ?? '';
    const position = Number(c.req.param('position'));
    const body = (await bodyOf(c)) as { scope?: unknown };
    const scope = body.scope === 'unit' ? 'unit' : 'person';
    const reading = await transaction(identity.organizationId, async (db) => {
      if (!reachesAnything(await reach(db, identity, 'performance:measure'))) {
        throw new GestureRefusal(403, 'forbidden', 'This needs performance:measure.');
      }
      const review = await findReview(db, reviewId);
      const line = review?.lines.find((l) => l.position === position);
      if (!review || !line) throw new GestureRefusal(404, 'not_found', 'No such review line.');
      const quarter = (await listQuarters(db)).find((q) => q.quarterId === review.quarterId);
      const { rows } = await db.query<{ indicator_id: string }>(
        `select indicator_id from indicators where name = $1 and formula = $2`,
        [line.name, line.formula],
      );
      const indicator = rows[0] ? await findIndicator(db, rows[0].indicator_id) : null;
      if (!indicator?.source || indicator.source.kind === 'typed') {
        throw new GestureRefusal(422, 'typed', 'This indicator is typed with its proof.');
      }
      const { rows: people } = await db.query<{ account_user_id: string | null }>(
        `select account_user_id from people where person_id = $1`,
        [review.personId],
      );
      const filter: ReadingFilter =
        scope === 'unit'
          ? { unit_id: review.unitId }
          : people[0]?.account_user_id
            ? { person_id: people[0].account_user_id }
            : {};
      return readIndicator({ db, identity, token: bearer(c) }, indicator, {
        filter,
        period: quarter ? { from: quarter.startsOn, to: quarter.endsOn } : null,
      });
    });
    if (reading.status !== 'done') {
      throw new GestureRefusal(422, reading.status, 'Its source gave no value: it stays to type.');
    }
    const proof = measureWords().fromSource(
      reading.provenance.source,
      reading.provenance.counted,
      reading.provenance.at.slice(0, 10),
    );
    return c.json(
      await run(c, recordMeasure, {
        reviewId,
        lines: [{ position, value: reading.value, proof }],
      }),
    );
  });
