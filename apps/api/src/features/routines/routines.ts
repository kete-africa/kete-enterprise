import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// Routines (spec 051): what runs for a person without her — at a set time (her scheduled tasks,
// spec 029), when an app of her team signals (triggers), when a figure she reads crosses its line
// (watches) — each with her rights, every run kept.

export function routinesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const person = `
  organization_id text not null,
  user_id text not null,
  name text not null check (length(name) between 1 and 200),
  email text not null check (length(email) between 3 and 320),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  title text not null check (length(title) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),`;
  return `
create table ${s}.routine_triggers (
  trigger_id text primary key,${person}
  prompt text not null check (length(prompt) between 1 and 2000),
  resource_id text not null,
  event_type text not null check (length(event_type) between 1 and 120)
);
create index routine_triggers_event on ${s}.routine_triggers (resource_id, event_type) where active;
${organizationPolicySql({ schema: s, table: 'routine_triggers', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.routine_triggers to ${options.appRole};

create table ${s}.routine_watches (
  watch_id text primary key,${person}
  dashboard_id text not null,
  card_id text not null,
  direction text not null check (direction in ('above', 'below')),
  line double precision not null,
  crossed boolean not null default false,
  last_value double precision,
  last_checked_at timestamptz
);
${organizationPolicySql({ schema: s, table: 'routine_watches', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.routine_watches to ${options.appRole};

create function ${s}.routine_watches_due() returns table (organization_id text, watch_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, watch_id from routine_watches
        where active and (last_checked_at is null or last_checked_at <= now() - interval '1 hour')
        order by last_checked_at nulls first limit 200 $$;
revoke all on function ${s}.routine_watches_due() from public;
grant execute on function ${s}.routine_watches_due() to ${options.appRole};

create table ${s}.routine_runs (
  run_id text primary key,
  organization_id text not null,
  user_id text not null,
  family text not null check (family in ('time', 'event', 'watch')),
  routine_id text not null,
  title text not null check (length(title) between 1 and 120),
  cause text not null check (length(cause) between 1 and 300),
  status text not null
    check (status in ('queued', 'running', 'done', 'failed', 'no_model', 'told', 'quiet')),
  summary text check (length(summary) <= 500),
  href text check (length(href) <= 500),
  tried boolean not null default false,
  event_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index routine_runs_queued on ${s}.routine_runs (created_at) where status = 'queued';
create index routine_runs_of on ${s}.routine_runs (user_id, created_at desc);
${organizationPolicySql({ schema: s, table: 'routine_runs', appRole: options.appRole })}
grant select, insert, update on ${s}.routine_runs to ${options.appRole};

create function ${s}.routine_runs_queued() returns table (organization_id text, run_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, run_id from routine_runs
        where status = 'queued' order by created_at limit 100 $$;
revoke all on function ${s}.routine_runs_queued() from public;
grant execute on function ${s}.routine_runs_queued() to ${options.appRole};
`;
}

/** The most triggers, and the most watches, one person keeps. */
export const MAX_ROUTINES = 20;
export class RoutineLimitError extends Error {}

/** Whom a routine runs for: her, in her words, without her token. */
export interface Person {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  locale: 'fr' | 'en';
}

export const triggerInput = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2000),
  resourceId: z.string().min(1).max(80),
  eventType: z.string().min(1).max(120),
});
export const watchInput = z.object({
  title: z.string().trim().min(1).max(120),
  dashboardId: z.string().regex(/^dsh_[0-9A-Za-z_-]{4,70}$/),
  cardId: z.string().regex(/^w[0-9a-z]{1,24}$/),
  direction: z.enum(['above', 'below']),
  line: z.number().finite(),
});

export interface Trigger {
  triggerId: string;
  title: string;
  prompt: string;
  resourceId: string;
  eventType: string;
  active: boolean;
  createdAt: string;
}
export interface Watch {
  watchId: string;
  title: string;
  dashboardId: string;
  cardId: string;
  direction: 'above' | 'below';
  line: number;
  active: boolean;
  crossed: boolean;
  lastValue: number | null;
  lastCheckedAt: string | null;
}
export type Family = 'time' | 'event' | 'watch';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'no_model' | 'told' | 'quiet';
export interface Run {
  runId: string;
  family: Family;
  routineId: string;
  title: string;
  cause: string;
  status: RunStatus;
  summary: string | null;
  href: string | null;
  tried: boolean;
  createdAt: string;
  finishedAt: string | null;
}

type TriggerRow = {
  trigger_id: string;
  organization_id: string;
  user_id: string;
  name: string;
  email: string;
  locale: 'fr' | 'en';
  title: string;
  prompt: string;
  resource_id: string;
  event_type: string;
  active: boolean;
  created_at: Date;
};
const triggerOf = (r: TriggerRow): Trigger => ({
  triggerId: r.trigger_id,
  title: r.title,
  prompt: r.prompt,
  resourceId: r.resource_id,
  eventType: r.event_type,
  active: r.active,
  createdAt: r.created_at.toISOString(),
});
const personOf = (r: {
  organization_id: string;
  user_id: string;
  name: string;
  email: string;
  locale: 'fr' | 'en';
}): Person => ({
  organizationId: r.organization_id,
  userId: r.user_id,
  name: r.name,
  email: r.email,
  locale: r.locale,
});

type WatchRow = {
  watch_id: string;
  organization_id: string;
  user_id: string;
  name: string;
  email: string;
  locale: 'fr' | 'en';
  title: string;
  dashboard_id: string;
  card_id: string;
  direction: 'above' | 'below';
  line: number;
  active: boolean;
  crossed: boolean;
  last_value: number | null;
  last_checked_at: Date | null;
};
const watchOf = (r: WatchRow): Watch => ({
  watchId: r.watch_id,
  title: r.title,
  dashboardId: r.dashboard_id,
  cardId: r.card_id,
  direction: r.direction,
  line: Number(r.line),
  active: r.active,
  crossed: r.crossed,
  lastValue: r.last_value === null ? null : Number(r.last_value),
  lastCheckedAt: r.last_checked_at?.toISOString() ?? null,
});

async function countOf(db: SqlExecutor, table: string, userId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from ${table} where user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function createTrigger(
  db: SqlExecutor,
  person: Person,
  input: z.infer<typeof triggerInput>,
): Promise<Trigger> {
  if ((await countOf(db, 'routine_triggers', person.userId)) >= MAX_ROUTINES) {
    throw new RoutineLimitError();
  }
  const { rows } = await db.query<TriggerRow>(
    `insert into routine_triggers (trigger_id, organization_id, user_id, name, email, locale, title,
       prompt, resource_id, event_type)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [
      newId('rtr'),
      person.organizationId,
      person.userId,
      person.name,
      person.email,
      person.locale,
      input.title,
      input.prompt,
      input.resourceId,
      input.eventType,
    ],
  );
  return triggerOf(rows[0] as TriggerRow);
}

export async function listTriggers(db: SqlExecutor, userId: string): Promise<Trigger[]> {
  const { rows } = await db.query<TriggerRow>(
    'select * from routine_triggers where user_id = $1 order by created_at',
    [userId],
  );
  return rows.map(triggerOf);
}

export async function triggerFor(
  db: SqlExecutor,
  triggerId: string,
  userId?: string,
): Promise<(Trigger & { person: Person }) | null> {
  const { rows } = await db.query<TriggerRow>(
    `select * from routine_triggers where trigger_id = $1 ${userId ? 'and user_id = $2' : ''}`,
    userId ? [triggerId, userId] : [triggerId],
  );
  const r = rows[0];
  return r ? { ...triggerOf(r), person: personOf(r) } : null;
}

/** The active triggers listening to an app's event type, with whom they run for. */
export async function triggersListening(
  db: SqlExecutor,
  resourceId: string,
  eventType: string,
): Promise<(Trigger & { person: Person })[]> {
  const { rows } = await db.query<TriggerRow>(
    `select * from routine_triggers where active and resource_id = $1 and event_type = $2`,
    [resourceId, eventType],
  );
  return rows.map((r) => ({ ...triggerOf(r), person: personOf(r) }));
}

export async function createWatch(
  db: SqlExecutor,
  person: Person,
  input: z.infer<typeof watchInput>,
): Promise<Watch> {
  if ((await countOf(db, 'routine_watches', person.userId)) >= MAX_ROUTINES) {
    throw new RoutineLimitError();
  }
  const { rows } = await db.query<WatchRow>(
    `insert into routine_watches (watch_id, organization_id, user_id, name, email, locale, title,
       dashboard_id, card_id, direction, line)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [
      newId('rwt'),
      person.organizationId,
      person.userId,
      person.name,
      person.email,
      person.locale,
      input.title,
      input.dashboardId,
      input.cardId,
      input.direction,
      input.line,
    ],
  );
  return watchOf(rows[0] as WatchRow);
}

export async function listWatches(db: SqlExecutor, userId: string): Promise<Watch[]> {
  const { rows } = await db.query<WatchRow>(
    'select * from routine_watches where user_id = $1 order by created_at',
    [userId],
  );
  return rows.map(watchOf);
}

export async function watchFor(
  db: SqlExecutor,
  watchId: string,
  userId?: string,
): Promise<(Watch & { person: Person }) | null> {
  const { rows } = await db.query<WatchRow>(
    `select * from routine_watches where watch_id = $1 ${userId ? 'and user_id = $2' : ''}
      for update`,
    userId ? [watchId, userId] : [watchId],
  );
  const r = rows[0];
  return r ? { ...watchOf(r), person: personOf(r) } : null;
}

/** What a check of a watch found: its value now, and whether it is on the far side of its line. */
export async function markWatch(
  db: SqlExecutor,
  watchId: string,
  check: { value: number | null; crossed: boolean },
): Promise<void> {
  await db.query(
    `update routine_watches set last_value = $2, crossed = $3, last_checked_at = now()
      where watch_id = $1`,
    [watchId, check.value, check.crossed],
  );
}

const tables = { trigger: 'routine_triggers', watch: 'routine_watches' } as const;
const keys = { trigger: 'trigger_id', watch: 'watch_id' } as const;

export async function setRoutineActive(
  db: SqlExecutor,
  kind: 'trigger' | 'watch',
  id: string,
  userId: string,
  active: boolean,
): Promise<boolean> {
  const { rows } = await db.query(
    `update ${tables[kind]} set active = $3 where ${keys[kind]} = $1 and user_id = $2
      returning ${keys[kind]}`,
    [id, userId, active],
  );
  return rows.length > 0;
}

export async function removeRoutine(
  db: SqlExecutor,
  kind: 'trigger' | 'watch',
  id: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `delete from ${tables[kind]} where ${keys[kind]} = $1 and user_id = $2 returning ${keys[kind]}`,
    [id, userId],
  );
  return rows.length > 0;
}

type RunRow = {
  run_id: string;
  organization_id: string;
  user_id: string;
  family: Family;
  routine_id: string;
  title: string;
  cause: string;
  status: RunStatus;
  summary: string | null;
  href: string | null;
  tried: boolean;
  event_id: string | null;
  created_at: Date;
  finished_at: Date | null;
};
const runOf = (r: RunRow): Run => ({
  runId: r.run_id,
  family: r.family,
  routineId: r.routine_id,
  title: r.title,
  cause: r.cause,
  status: r.status,
  summary: r.summary,
  href: r.href,
  tried: r.tried,
  createdAt: r.created_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
});

/** Keeps a run: queued for the worker, or already over. */
export async function recordRun(
  db: SqlExecutor,
  run: {
    organizationId: string;
    userId: string;
    family: Family;
    routineId: string;
    title: string;
    cause: string;
    status: RunStatus;
    summary?: string | null;
    href?: string | null;
    tried?: boolean;
    eventId?: string;
  },
): Promise<string> {
  const runId = newId('rrn');
  await db.query(
    `insert into routine_runs (run_id, organization_id, user_id, family, routine_id, title, cause,
       status, summary, href, tried, event_id, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       case when $8 in ('queued', 'running') then null else now() end)`,
    [
      runId,
      run.organizationId,
      run.userId,
      run.family,
      run.routineId,
      run.title.slice(0, 120),
      run.cause.slice(0, 300),
      run.status,
      run.summary?.slice(0, 500) ?? null,
      run.href ?? null,
      run.tried ?? false,
      run.eventId ?? null,
    ],
  );
  return runId;
}

/** Takes a queued run for the worker, once. */
export async function claimRun(
  db: SqlExecutor,
  runId: string,
): Promise<(Run & { userId: string; eventId: string | null }) | null> {
  const { rows } = await db.query<RunRow>(
    `update routine_runs set status = 'running'
      where run_id = $1 and status = 'queued' returning *`,
    [runId],
  );
  const r = rows[0];
  return r ? { ...runOf(r), userId: r.user_id, eventId: r.event_id } : null;
}

export async function finishRun(
  db: SqlExecutor,
  runId: string,
  outcome: { status: RunStatus; summary: string | null; href: string | null },
): Promise<void> {
  await db.query(
    `update routine_runs set status = $2, summary = $3, href = $4, finished_at = now()
      where run_id = $1`,
    [runId, outcome.status, outcome.summary?.slice(0, 500) ?? null, outcome.href],
  );
}

export async function listRuns(db: SqlExecutor, userId: string, limit = 30): Promise<Run[]> {
  const { rows } = await db.query<RunRow>(
    'select * from routine_runs where user_id = $1 order by created_at desc limit $2',
    [userId, limit],
  );
  return rows.map(runOf);
}

/** How many routine runs failed since a date, across the organization (spec 054). */
export async function failedRunsSince(db: SqlExecutor, since: Date): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from routine_runs where status = 'failed' and created_at >= $1`,
    [since],
  );
  return Number(rows[0]?.n ?? 0);
}
