import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type pg from 'pg';
import { z } from 'zod';
import { knownTimeZone, nextRun, type Cadence } from './when.js';

// A person's scheduled tasks (spec 029): her morning briefing, or a question her assistant answers
// at a set time — « every Monday at 8, the late actions of my team » — with her rights, never more.
// The answer lands in her « To do », and in her mailbox when she asks for it.

export function schedulesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.assistant_schedules (
  schedule_id text primary key,
  organization_id text not null,
  user_id text not null,
  name text not null check (length(name) between 1 and 200),
  email text not null check (length(email) between 3 and 320),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  kind text not null check (kind in ('briefing', 'prompt')),
  title text not null check (length(title) between 1 and 120),
  prompt text check (length(prompt) <= 2000),
  cadence text not null check (cadence in ('daily', 'weekdays', 'weekly')),
  weekday smallint check (weekday between 1 and 7),
  time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text not null,
  by_email boolean not null default false,
  active boolean not null default true,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  last_status text check (last_status in ('done', 'failed', 'no_model')),
  created_at timestamptz not null default now(),
  check (kind = 'briefing' or prompt is not null),
  check ((cadence = 'weekly') = (weekday is not null))
);
create index assistant_schedules_due on ${s}.assistant_schedules (next_run_at) where active;
${organizationPolicySql({ schema: s, table: 'assistant_schedules', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.assistant_schedules to ${options.appRole};

create function ${s}.assistant_schedules_due() returns table (organization_id text, schedule_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, schedule_id from assistant_schedules
        where active and next_run_at <= now() order by next_run_at limit 200 $$;
revoke all on function ${s}.assistant_schedules_due() from public;
grant execute on function ${s}.assistant_schedules_due() to ${options.appRole};
`;
}

/** The most scheduled tasks one person keeps. */
export const MAX_SCHEDULES = 20;

export const scheduleInput = z
  .object({
    kind: z.enum(['briefing', 'prompt']),
    title: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(2000).optional(),
    cadence: z.enum(['daily', 'weekdays', 'weekly']),
    weekday: z.number().int().min(1).max(7).optional(),
    time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
    timeZone: z.string().min(1).max(64).refine(knownTimeZone).default('Africa/Lome'),
    byEmail: z.boolean().default(false),
    locale: z.enum(['fr', 'en']).default('fr'),
  })
  .refine((v) => v.kind === 'briefing' || Boolean(v.prompt), { path: ['prompt'] })
  .refine((v) => (v.cadence === 'weekly') === (v.weekday !== undefined), { path: ['weekday'] });

export type ScheduleInput = z.infer<typeof scheduleInput>;

export interface Schedule {
  scheduleId: string;
  kind: 'briefing' | 'prompt';
  title: string;
  prompt: string | null;
  cadence: Cadence;
  weekday: number | null;
  time: string;
  timeZone: string;
  byEmail: boolean;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'done' | 'failed' | 'no_model' | null;
}

/** A schedule as the worker runs it: whom it runs for, in her words. */
export interface ScheduleRun extends Schedule {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  locale: 'fr' | 'en';
}

type Row = {
  schedule_id: string;
  organization_id: string;
  user_id: string;
  name: string;
  email: string;
  locale: 'fr' | 'en';
  kind: 'briefing' | 'prompt';
  title: string;
  prompt: string | null;
  cadence: Cadence;
  weekday: number | null;
  time: string;
  time_zone: string;
  by_email: boolean;
  active: boolean;
  next_run_at: Date;
  last_run_at: Date | null;
  last_status: Schedule['lastStatus'];
};

const COLUMNS = `schedule_id, organization_id, user_id, name, email, locale, kind, title, prompt,
  cadence, weekday, time, time_zone, by_email, active, next_run_at, last_run_at, last_status`;

const shown = (r: Row): Schedule => ({
  scheduleId: r.schedule_id,
  kind: r.kind,
  title: r.title,
  prompt: r.prompt,
  cadence: r.cadence,
  weekday: r.weekday,
  time: r.time,
  timeZone: r.time_zone,
  byEmail: r.by_email,
  active: r.active,
  nextRunAt: r.next_run_at.toISOString(),
  lastRunAt: r.last_run_at?.toISOString() ?? null,
  lastStatus: r.last_status,
});

const run = (r: Row): ScheduleRun => ({
  ...shown(r),
  organizationId: r.organization_id,
  userId: r.user_id,
  name: r.name,
  email: r.email,
  locale: r.locale,
});

const whenOf = (r: Pick<Row, 'cadence' | 'weekday' | 'time' | 'time_zone'>) => ({
  cadence: r.cadence,
  weekday: r.weekday,
  time: r.time,
  timeZone: r.time_zone,
});

export async function listSchedules(db: SqlExecutor, userId: string): Promise<Schedule[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from assistant_schedules where user_id = $1 order by created_at`,
    [userId],
  );
  return rows.map(shown);
}

export class ScheduleLimitError extends Error {}

/** Keeps a new schedule for her; its first run is the next time it falls. */
export async function createSchedule(
  db: SqlExecutor,
  person: { organizationId: string; userId: string; name: string; email: string },
  input: ScheduleInput,
  now = new Date(),
): Promise<Schedule> {
  const { rows: count } = await db.query<{ n: number }>(
    `select count(*)::int as n from assistant_schedules where user_id = $1`,
    [person.userId],
  );
  if ((count[0]?.n ?? 0) >= MAX_SCHEDULES) throw new ScheduleLimitError();
  const weekday = input.cadence === 'weekly' ? (input.weekday ?? null) : null;
  const next = nextRun(
    { cadence: input.cadence, weekday, time: input.time, timeZone: input.timeZone },
    now,
  );
  const { rows } = await db.query<Row>(
    `insert into assistant_schedules (schedule_id, organization_id, user_id, name, email, locale,
       kind, title, prompt, cadence, weekday, time, time_zone, by_email, next_run_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning ${COLUMNS}`,
    [
      newId('sch'),
      person.organizationId,
      person.userId,
      person.name,
      person.email,
      input.locale,
      input.kind,
      input.title,
      input.kind === 'prompt' ? (input.prompt ?? null) : null,
      input.cadence,
      weekday,
      input.time,
      input.timeZone,
      input.byEmail,
      next,
    ],
  );
  return shown(rows[0] as Row);
}

/** Pauses or resumes one of hers; resumed, it runs at its next time — never to catch up. */
export async function setScheduleActive(
  db: SqlExecutor,
  userId: string,
  scheduleId: string,
  active: boolean,
  now = new Date(),
): Promise<Schedule | null> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from assistant_schedules where user_id = $1 and schedule_id = $2`,
    [userId, scheduleId],
  );
  const found = rows[0];
  if (!found) return null;
  const { rows: updated } = await db.query<Row>(
    `update assistant_schedules set active = $2, next_run_at = $3 where schedule_id = $1
     returning ${COLUMNS}`,
    [scheduleId, active, active ? nextRun(whenOf(found), now) : found.next_run_at],
  );
  return updated[0] ? shown(updated[0]) : null;
}

export async function removeSchedule(
  db: SqlExecutor,
  userId: string,
  scheduleId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ schedule_id: string }>(
    `delete from assistant_schedules where user_id = $1 and schedule_id = $2 returning schedule_id`,
    [userId, scheduleId],
  );
  return rows.length > 0;
}

/** The schedules due now, across organizations (the worker's round). */
export async function schedulesDue(
  pool: pg.Pool,
): Promise<{ organizationId: string; scheduleId: string }[]> {
  const { rows } = await pool.query<{ organization_id: string; schedule_id: string }>(
    `select organization_id, schedule_id from assistant_schedules_due()`,
  );
  return rows.map((r) => ({ organizationId: r.organization_id, scheduleId: r.schedule_id }));
}

/**
 * Takes one schedule to run: its next time is set first, so that two rounds never run it twice.
 * With `now`, a schedule of hers runs at once (« Lancer maintenant »), whatever its time.
 */
export async function claimSchedule(
  db: SqlExecutor,
  scheduleId: string,
  options: { userId?: string; due: boolean },
  now = new Date(),
): Promise<ScheduleRun | null> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from assistant_schedules
      where schedule_id = $1 ${options.userId ? 'and user_id = $2' : ''}
        ${options.due ? 'and active and next_run_at <= now()' : ''}
      for update skip locked`,
    options.userId ? [scheduleId, options.userId] : [scheduleId],
  );
  const found = rows[0];
  if (!found) return null;
  await db.query(
    `update assistant_schedules set next_run_at = $2, last_run_at = now() where schedule_id = $1`,
    [scheduleId, options.due ? nextRun(whenOf(found), now) : found.next_run_at],
  );
  return run(found);
}

export async function markScheduleRun(
  db: SqlExecutor,
  scheduleId: string,
  status: 'done' | 'failed' | 'no_model',
): Promise<void> {
  await db.query(`update assistant_schedules set last_status = $2 where schedule_id = $1`, [
    scheduleId,
    status,
  ]);
}
