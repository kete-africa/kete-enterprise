import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { z } from 'zod';
import { findIndicator, indicatorSourceInput, type Reading } from './measure.js';

// The Measure's gestures (spec 102), each kept in the journal: an indicator's source and rule, and
// a freeze of readings — a board's summary or a quarter's « arrêté » (D-052).

export class MeasureRefusal extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/** Where an indicator's figure comes from, and when it is green, orange or red. */
export const setIndicatorSource = defineCommand({
  name: 'set-indicator-source',
  input: indicatorSourceInput,
  reversibility: { reversible: true, inverse: 'set-indicator-source' },
  async handler(input, { db }) {
    if (!(await findIndicator(db, input.indicatorId))) {
      throw new MeasureRefusal('not_found', 'No such indicator.');
    }
    const ruled = [input.direction, input.target, input.threshold, input.alertWhen];
    if (ruled.some((v) => v !== undefined) && ruled.some((v) => v === undefined)) {
      throw new MeasureRefusal(
        'invalid',
        'A rule names its direction, target, threshold and comparison together.',
      );
    }
    if (input.ownerPositionId) {
      const { rows } = await db.query(`select 1 from positions where position_id = $1`, [
        input.ownerPositionId,
      ]);
      if (rows.length === 0) throw new MeasureRefusal('not_found', 'No such position.');
    }
    await db.query(
      `update indicators set source_ref = $2, unit = $3, direction = $4, target = $5,
         threshold = $6, alert_when = $7, owner_position_id = $8, updated_at = now()
       where indicator_id = $1`,
      [
        input.indicatorId,
        JSON.stringify(input.source),
        input.unit ?? null,
        input.direction ?? null,
        input.target ?? null,
        input.threshold ?? null,
        input.alertWhen ?? null,
        input.ownerPositionId ?? null,
      ],
    );
    return { indicator: await findIndicator(db, input.indicatorId) };
  },
  summarize: (input) => `Indicator ${input.indicatorId}: its source is ${input.source.kind}`,
});

const readingShape = z.custom<Reading>((v) => typeof v === 'object' && v !== null);

/** Readings kept as they were read: they never change after. */
export const freezeReadings = defineCommand({
  name: 'freeze-readings',
  input: z.object({
    label: z.string().trim().min(1).max(120),
    period: z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .nullable(),
    filter: z.record(z.string(), z.string()).default({}),
    readings: z.array(readingShape).min(1).max(100),
    frozenBy: z.string().min(1).max(128),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const id = newId('frz');
    await db.query(
      `insert into measure_freezes (organization_id, freeze_id, label, period_from, period_to,
         filter, readings, frozen_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        id,
        input.label,
        input.period?.from ?? null,
        input.period?.to ?? null,
        JSON.stringify(input.filter),
        JSON.stringify(input.readings),
        input.frozenBy,
      ],
    );
    return { freezeId: id, label: input.label, count: input.readings.length };
  },
  summarize: (input) => `${input.label}: ${input.readings.length} reading(s) frozen`,
});
