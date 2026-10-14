import type { DatedFact } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { conflicts, type Conflict } from '@kete/time';
import { z } from 'zod';

// The time of the organization (spec 079, doctrine D-050): the apps say what will happen at a time
// — a meeting, a deadline, a leave, a task, a milestone, an agent's run — in the shape of the
// contract `dated-fact.v1` (kete-core); the center keeps them, and Planifier shows them to each
// person within what she may see. An app owns its facts: said again under its key, a fact is
// replaced; cancelled, it is gone. What clashes is computed by `@kete/time`, never guessed.

export function timeMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.time_facts (
  organization_id text not null,
  -- The app that said it, and its own key: said again, the fact is replaced.
  source text not null check (length(source) between 1 and 80),
  key text not null check (length(key) between 1 and 200),
  kind text not null
    check (kind in ('meeting', 'deadline', 'absence', 'task', 'milestone', 'agent_run')),
  label text not null check (length(label) between 1 and 300),
  day date,
  until date,
  starts_at timestamptz,
  ends_at timestamptz,
  -- The Compte Kete accounts it concerns.
  person_ids text[] not null default '{}' check (cardinality(person_ids) <= 50),
  project_id text,
  party_id text,
  visibility text not null default 'shared' check (visibility in ('shared', 'busy', 'private')),
  href text check (length(href) <= 600),
  said_by text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, source, key),
  check ((day is null) <> (starts_at is null)),
  check (until is null or (day is not null and until >= day)),
  check (ends_at is null or (starts_at is not null and ends_at >= starts_at))
);
create index time_facts_days on ${s}.time_facts (organization_id, day, until);
create index time_facts_moments on ${s}.time_facts (organization_id, starts_at);
${organizationPolicySql({ schema: s, table: 'time_facts', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.time_facts to ${options.appRole};
`;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moment = z.iso.datetime({ offset: true });

/** A dated fact, as the contract `dated-fact.v1` writes it. */
export const datedFactInput = z
  .object({
    key: z.string().min(1).max(200),
    kind: z.enum(['meeting', 'deadline', 'absence', 'task', 'milestone', 'agent_run']),
    label: z.string().min(1).max(300),
    day: date.optional(),
    until: date.optional(),
    starts_at: moment.optional(),
    ends_at: moment.optional(),
    person_ids: z.array(z.string().min(1).max(100)).max(50).optional(),
    project_id: z
      .string()
      .regex(/^prj_[0-9a-f-]{8,64}$/)
      .optional(),
    party_id: z
      .string()
      .regex(/^pty_[0-9a-f-]{8,64}$/)
      .optional(),
    visibility: z.enum(['shared', 'busy', 'private']).optional(),
    href: z.url().max(600).optional(),
    cancelled: z.boolean().optional(),
  })
  .strict()
  .refine((f) => (f.day === undefined) !== (f.starts_at === undefined), {
    message: 'Exactly one of day and starts_at.',
  })
  .refine((f) => !f.until || (f.day && f.until >= f.day), { message: 'until follows day.' })
  .refine((f) => !f.ends_at || (f.starts_at && f.ends_at >= f.starts_at), {
    message: 'ends_at follows starts_at.',
  });
export type DatedFactInput = z.output<typeof datedFactInput>;

/** Says a fact: kept, or replaced under its key; a cancelled one is taken back. */
export async function sayTimeFact(
  db: SqlExecutor,
  organizationId: string,
  said: { source: string; fact: DatedFactInput; by: string },
): Promise<'kept' | 'dropped'> {
  const { fact } = said;
  if (fact.cancelled) {
    await dropTimeFact(db, said.source, fact.key);
    return 'dropped';
  }
  await db.query(
    `insert into time_facts (organization_id, source, key, kind, label, day, until, starts_at,
       ends_at, person_ids, project_id, party_id, visibility, href, said_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (organization_id, source, key) do update set
       kind = excluded.kind, label = excluded.label, day = excluded.day, until = excluded.until,
       starts_at = excluded.starts_at, ends_at = excluded.ends_at, person_ids = excluded.person_ids,
       project_id = excluded.project_id, party_id = excluded.party_id,
       visibility = excluded.visibility, href = excluded.href, said_by = excluded.said_by,
       updated_at = now()`,
    [
      organizationId,
      said.source,
      fact.key,
      fact.kind,
      fact.label,
      fact.day ?? null,
      fact.until ?? null,
      fact.starts_at ?? null,
      fact.ends_at ?? null,
      [...new Set(fact.person_ids ?? [])],
      fact.project_id ?? null,
      fact.party_id ?? null,
      fact.visibility ?? 'shared',
      fact.href ?? null,
      said.by,
    ],
  );
  return 'kept';
}

export async function dropTimeFact(db: SqlExecutor, source: string, key: string): Promise<void> {
  await db.query(`delete from time_facts where source = $1 and key = $2`, [source, key]);
}

/** A fact as the center keeps it: the contract's shape, with the app that said it. */
export interface KeptFact extends DatedFact {
  source: string;
}

interface Row extends Record<string, unknown> {
  source: string;
  key: string;
  kind: DatedFact['kind'];
  label: string;
  day: string | null;
  until: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  person_ids: string[];
  project_id: string | null;
  party_id: string | null;
  visibility: NonNullable<DatedFact['visibility']>;
  href: string | null;
}

const toFact = (row: Row): KeptFact =>
  ({
    source: row.source,
    key: `${row.source}:${row.key}`,
    kind: row.kind,
    label: row.label,
    ...(row.day ? { day: row.day } : {}),
    ...(row.until ? { until: row.until } : {}),
    ...(row.starts_at ? { starts_at: row.starts_at.toISOString() } : {}),
    ...(row.ends_at ? { ends_at: row.ends_at.toISOString() } : {}),
    ...(row.person_ids.length ? { person_ids: row.person_ids } : {}),
    ...(row.project_id ? { project_id: row.project_id } : {}),
    ...(row.party_id ? { party_id: row.party_id } : {}),
    visibility: row.visibility,
    ...(row.href ? { href: row.href } : {}),
  }) as KeptFact;

/** The facts that meet the days between `from` and `to`, both included. */
export async function factsBetween(
  db: SqlExecutor,
  from: string,
  to: string,
): Promise<KeptFact[]> {
  const { rows } = await db.query<Row>(
    `select source, key, kind, label, to_char(day, 'YYYY-MM-DD') as day,
            to_char(until, 'YYYY-MM-DD') as until, starts_at, ends_at, person_ids, project_id,
            party_id, visibility, href
       from time_facts
      where (day is not null and day <= $2::date and coalesce(until, day) >= $1::date)
         or (starts_at is not null and starts_at < ($2::date + 1) and coalesce(ends_at, starts_at) >= $1::date)
      order by coalesce(day::timestamptz, starts_at)
      limit 2000`,
    [from, to],
  );
  return rows.map(toFact);
}

/** Who looks, and what her place lets her see. */
export interface Viewer {
  userId: string;
  /** The people whose time she sees: herself, her reports in « Mon équipe ». */
  people: ReadonlySet<string>;
  /** The projects she belongs to. */
  projects: ReadonlySet<string>;
  /** « Toute l'organisation »: every shared fact, by her rights. */
  everyone: boolean;
}

/** A fact as she may read it: a busy one or another's absence without its words. */
export type SeenFact = KeptFact & { masked?: boolean };

/**
 * What a person sees of the facts (D-050): hers; her people's; her projects'; what concerns no one
 * in particular (a deadline); everything shared when her rights open the whole organization. A
 * private fact only by the people it concerns; a « busy » one, and another person's absence, without
 * its words — never the reason of an absence.
 */
export function visibleTo(facts: readonly KeptFact[], viewer: Viewer): SeenFact[] {
  return facts.flatMap((fact): SeenFact[] => {
    const people = fact.person_ids ?? [];
    const hers = people.includes(viewer.userId);
    if (fact.visibility === 'private' && !hers) return [];
    const reached =
      hers ||
      viewer.everyone ||
      people.some((p) => viewer.people.has(p)) ||
      (fact.project_id !== undefined && viewer.projects.has(fact.project_id)) ||
      (people.length === 0 && fact.project_id === undefined);
    if (!reached) return [];
    const masked = !hers && (fact.visibility === 'busy' || fact.kind === 'absence');
    return [masked ? { ...fact, label: '', masked: true } : fact];
  });
}

/** What clashes among what she sees: someone expected while away, someone in two places. */
export function clashesOf(facts: readonly SeenFact[], offsetMinutes = 0): Conflict[] {
  return conflicts(facts, offsetMinutes);
}
