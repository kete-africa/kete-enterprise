import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { colourOf } from './compute.js';
import {
  findReview,
  listQuarters,
  listReviews,
  writeLine,
} from './infrastructure/performance.tables.js';

/**
 * Readings (spec 015): a value of an indicator for a quarter, sent by a connected app — the helpdesk
 * for its tickets, tomorrow another — with its proof. A reading is a source, not a measure:
 * management control takes it into a review, or not. Append-only for the application role.
 */
export function readingsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.indicator_readings (
  reading_id text primary key,
  organization_id text not null,
  quarter text not null check (length(quarter) between 1 and 40),
  indicator text not null check (length(indicator) between 1 and 300),
  unit_id text,
  value numeric not null,
  proof text not null check (length(proof) between 1 and 600),
  source text not null check (length(source) between 1 and 80),
  sent_by text not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, unit_id) references ${s}.units (organization_id, unit_id)
);
create index indicator_readings_quarter on ${s}.indicator_readings (organization_id, quarter, indicator);
${organizationPolicySql({ schema: s, table: 'indicator_readings', appRole: options.appRole })}
revoke all on ${s}.indicator_readings from ${options.appRole};
grant select, insert on ${s}.indicator_readings to ${options.appRole};
`;
}

export interface Reading {
  readingId: string;
  quarter: string;
  indicator: string;
  unitId: string | null;
  value: number;
  proof: string;
  source: string;
  createdAt: string;
}

export class ReadingRuleError extends Error {
  constructor(
    readonly code: 'unknown_indicator' | 'not_found' | 'not_open',
    message: string,
  ) {
    super(message);
    this.name = 'ReadingRuleError';
  }
}

export const recordReading = defineCommand({
  name: 'record-reading',
  input: z.object({
    quarter: z.string().trim().min(1).max(40),
    indicator: z.string().trim().min(1).max(300),
    unitId: z
      .string()
      .regex(/^unt_[0-9a-f-]{8,64}$/)
      .optional(),
    value: z.number().finite(),
    proof: z.string().trim().min(1).max(600),
    source: z.string().trim().min(1).max(80),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    // A reading names an indicator the organization measures: otherwise nobody would take it.
    const { rows } = await db.query(`select 1 from indicators where name = $1 limit 1`, [
      input.indicator,
    ]);
    if (rows.length === 0) {
      throw new ReadingRuleError('unknown_indicator', 'No indicator of that name here.');
    }
    const readingId = newId('rdg');
    await db
      .query(
        `insert into indicator_readings (reading_id, organization_id, quarter, indicator, unit_id,
           value, proof, source, sent_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          readingId,
          organizationId,
          input.quarter,
          input.indicator,
          input.unitId ?? null,
          input.value,
          input.proof,
          input.source,
          actor.onBehalfOf?.id ?? actor.id,
        ],
      )
      .catch((error: { code?: string }) => {
        if (error.code === '23503') throw new ReadingRuleError('not_found', 'No such unit.');
        throw error;
      });
    return { readingId };
  },
  summarize: (input) => `${input.source}: a reading of « ${input.indicator} » for ${input.quarter}`,
});

export async function listReadings(db: SqlExecutor, quarter: string): Promise<Reading[]> {
  const { rows } = await db.query<{
    reading_id: string;
    quarter: string;
    indicator: string;
    unit_id: string | null;
    value: string;
    proof: string;
    source: string;
    created_at: Date;
  }>(
    `select reading_id, quarter, indicator, unit_id, value, proof, source, created_at
       from indicator_readings where quarter = $1 order by created_at desc`,
    [quarter],
  );
  return rows.map((r) => ({
    readingId: r.reading_id,
    quarter: r.quarter,
    indicator: r.indicator,
    unitId: r.unit_id,
    value: Number(r.value),
    proof: r.proof,
    source: r.source,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Management control takes a reading into a review's line: the value, and its proof. */
export const measureFromReading = defineCommand({
  name: 'measure-from-reading',
  input: z.object({
    reviewId: z.string().regex(/^rvw_[0-9a-f-]{8,64}$/),
    position: z.number().int().min(1).max(20),
    readingId: z.string().regex(/^rdg_[0-9a-f-]{8,64}$/),
  }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const review = await findReview(db, input.reviewId, true);
    if (!review) throw new ReadingRuleError('not_found', 'No such review.');
    if (review.status !== 'open') throw new ReadingRuleError('not_open', 'Measures are closed.');
    const line = review.lines.find((l) => l.position === input.position);
    const { rows } = await db.query<{ value: string; proof: string; source: string }>(
      `select value, proof, source from indicator_readings where reading_id = $1`,
      [input.readingId],
    );
    const reading = rows[0];
    if (!line || !reading) throw new ReadingRuleError('not_found', 'No such line or reading.');
    const value = Number(reading.value);
    await writeLine(db, review.reviewId, line.position, {
      value,
      colour: line.kind === 'malus' ? null : colourOf(line, value),
      proof: `${reading.source} — ${reading.proof}`,
    });
    return { reviewId: review.reviewId, position: line.position, value };
  },
  summarize: (input) => `Review ${input.reviewId}, line ${input.position}: from a reading`,
});

/**
 * The readings waiting to be taken (spec 017): for each open review of an open quarter, a line
 * still without a value whose indicator has a reading for that quarter — what an agent may propose
 * to measure, as a draft. Only the reviews of units the person measures (`mayMeasure`).
 */
export async function readingsToTake(db: SqlExecutor, mayMeasure: (unitId: string) => boolean) {
  const quarters = (await listQuarters(db)).filter((q) => q.status === 'open');
  const found: {
    reviewId: string;
    personName: string;
    quarter: string;
    position: number;
    indicator: string;
    readingId: string;
    value: number;
    proof: string;
    source: string;
  }[] = [];
  for (const quarter of quarters) {
    const readings = await listReadings(db, quarter.label);
    if (readings.length === 0) continue;
    const reviews = await listReviews(db, { quarterId: quarter.quarterId }, true);
    for (const review of reviews) {
      if (review.status !== 'open' || !mayMeasure(review.unitId)) continue;
      for (const line of review.lines) {
        if (line.value !== null) continue;
        const reading = readings.find((r) => r.indicator === line.name);
        if (!reading) continue;
        found.push({
          reviewId: review.reviewId,
          personName: review.personName,
          quarter: quarter.label,
          position: line.position,
          indicator: line.name,
          readingId: reading.readingId,
          value: reading.value,
          proof: reading.proof,
          source: reading.source,
        });
      }
    }
  }
  return found;
}
