import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { Colour, Comparison, LineKind, Malus, Scale } from '../compute.js';
import type {
  ProfileInput,
  ProfileLineInput,
  QuarterStatus,
  ReviewStatus,
} from '../performance.record.js';

/**
 * The indicators' catalogue, job profiles and their lines, quarters, reviews and their frozen lines
 * (spec 012), each with its row-level security in the same migration.
 */
export function performanceMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  const attributes = `target_text text not null default '',
  threshold_text text not null default '',
  direction text check (direction in ('higher', 'lower')),
  target numeric,
  threshold numeric,
  alert_when text check (alert_when in ('<', '<=', '>', '>=')),
  weight numeric check (weight >= 0 and weight <= 1),
  kind text not null check (kind in ('scored', 'penalizing', 'blocking', 'malus')),
  malus jsonb`;
  return `
create table ${s}.indicators (
  indicator_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 300),
  formula text not null default '',
  source text not null default '',
  frequency text not null default '',
  reliable boolean not null default true,
  is_leading boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, indicator_id),
  unique (organization_id, name, formula)
);
${policy('indicators')}

create table ${s}.job_profiles (
  profile_id text primary key,
  organization_id text not null,
  title text not null check (length(title) between 1 and 200),
  category text not null default '',
  direction text,
  weights jsonb not null,
  source text not null default '',
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id),
  unique (organization_id, title)
);
${policy('job_profiles')}

create table ${s}.profile_lines (
  organization_id text not null,
  profile_id text not null,
  position integer not null check (position >= 1),
  indicator_id text not null,
  ${attributes},
  primary key (profile_id, position),
  foreign key (organization_id, profile_id) references ${s}.job_profiles (organization_id, profile_id),
  foreign key (organization_id, indicator_id) references ${s}.indicators (organization_id, indicator_id)
);
${policy('profile_lines')}

create table ${s}.position_profiles (
  position_id text primary key,
  organization_id text not null,
  profile_id text not null,
  foreign key (organization_id, position_id) references ${s}.positions (organization_id, position_id),
  foreign key (organization_id, profile_id) references ${s}.job_profiles (organization_id, profile_id)
);
${policy('position_profiles')}

create table ${s}.performance_quarters (
  quarter_id text primary key,
  organization_id text not null,
  label text not null check (length(label) between 1 and 40),
  starts_on date not null,
  ends_on date not null check (ends_on > starts_on),
  status text not null default 'draft' check (status in ('draft', 'open', 'measured', 'closed')),
  progressive boolean not null default false,
  scale jsonb not null,
  group_factor numeric check (group_factor >= 0 and group_factor <= 1),
  group_triggered boolean not null default true,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  measured_at timestamptz,
  closed_at timestamptz,
  unique (organization_id, quarter_id),
  unique (organization_id, label)
);
${policy('performance_quarters')}

create table ${s}.quarter_units (
  organization_id text not null,
  quarter_id text not null,
  unit_id text not null,
  factor numeric not null check (factor >= 0 and factor <= 1),
  primary key (quarter_id, unit_id),
  foreign key (organization_id, quarter_id)
    references ${s}.performance_quarters (organization_id, quarter_id),
  foreign key (organization_id, unit_id) references ${s}.units (organization_id, unit_id)
);
${policy('quarter_units')}

create table ${s}.reviews (
  review_id text primary key,
  organization_id text not null,
  quarter_id text not null,
  person_id text not null,
  position_id text not null,
  unit_id text not null,
  manager_person_id text,
  profile_title text not null,
  weights jsonb not null,
  status text not null default 'open'
    check (status in ('open', 'measured', 'manager_signed', 'signed', 'validated', 'missed')),
  acknowledged_at timestamptz,
  record jsonb not null default '{}',
  manager_signed_at timestamptz,
  manager_signed_by text,
  person_observations text,
  person_signed_at timestamptz,
  validated_at timestamptz,
  validated_by text,
  individual numeric,
  collective numeric,
  group_part numeric,
  factor numeric,
  fallback boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, review_id),
  unique (quarter_id, person_id, position_id),
  foreign key (organization_id, quarter_id)
    references ${s}.performance_quarters (organization_id, quarter_id),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id),
  foreign key (organization_id, position_id) references ${s}.positions (organization_id, position_id)
);
create index reviews_person on ${s}.reviews (organization_id, person_id);
create index reviews_manager on ${s}.reviews (organization_id, manager_person_id);
${policy('reviews')}

create table ${s}.review_lines (
  organization_id text not null,
  review_id text not null,
  position integer not null,
  name text not null,
  formula text not null default '',
  source text not null default '',
  frequency text not null default '',
  reliable boolean not null default true,
  ${attributes},
  value numeric,
  colour text check (colour in ('green', 'orange', 'red')),
  proof text,
  measured_at timestamptz,
  primary key (review_id, position),
  foreign key (organization_id, review_id) references ${s}.reviews (organization_id, review_id)
);
${policy('review_lines')}

grant select, insert, update on ${s}.indicators, ${s}.job_profiles, ${s}.position_profiles,
  ${s}.performance_quarters, ${s}.quarter_units, ${s}.reviews, ${s}.review_lines
  to ${options.appRole};
grant select, insert, update, delete on ${s}.profile_lines to ${options.appRole};
`;
}

// ---------------------------------------------------------------- catalogue and profiles

export async function upsertIndicator(
  db: SqlExecutor,
  organizationId: string,
  line: ProfileLineInput,
): Promise<string> {
  const { rows } = await db.query<{ indicator_id: string }>(
    `insert into indicators (indicator_id, organization_id, name, formula, source, frequency,
       reliable, is_leading)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (organization_id, name, formula) do update
       set source = excluded.source, frequency = excluded.frequency
     returning indicator_id`,
    [
      newId('ind'),
      organizationId,
      line.name,
      line.formula,
      line.source,
      line.frequency,
      line.reliable,
      line.leading,
    ],
  );
  return (rows[0] as { indicator_id: string }).indicator_id;
}

export async function upsertProfile(
  db: SqlExecutor,
  organizationId: string,
  profile: ProfileInput,
  source: string,
): Promise<string> {
  const { rows } = await db.query<{ profile_id: string }>(
    `insert into job_profiles (profile_id, organization_id, title, category, direction, weights,
       source)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, title) do update
       set category = excluded.category, direction = excluded.direction,
           weights = excluded.weights, source = excluded.source, updated_at = now()
     returning profile_id`,
    [
      newId('jpf'),
      organizationId,
      profile.title,
      profile.category,
      profile.direction,
      JSON.stringify(profile.weights),
      source,
    ],
  );
  const profileId = (rows[0] as { profile_id: string }).profile_id;
  // Reviews keep their own copy of the lines: a profile's new lines apply to the next quarter.
  await db.query(`delete from profile_lines where profile_id = $1`, [profileId]);
  for (const [index, line] of profile.lines.entries()) {
    const indicatorId = await upsertIndicator(db, organizationId, line);
    await db.query(
      `insert into profile_lines (organization_id, profile_id, position, indicator_id, target_text,
         threshold_text, direction, target, threshold, alert_when, weight, kind, malus)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        organizationId,
        profileId,
        index + 1,
        indicatorId,
        line.targetText,
        line.thresholdText,
        line.direction,
        line.target,
        line.threshold,
        line.alertWhen,
        line.weight,
        line.kind,
        line.malus ? JSON.stringify(line.malus) : null,
      ],
    );
  }
  return profileId;
}

export async function profileExists(db: SqlExecutor, profileId: string): Promise<boolean> {
  const { rows } = await db.query(`select 1 from job_profiles where profile_id = $1`, [profileId]);
  return rows.length > 0;
}

/** Positions without a profile take the one whose title is theirs. */
export async function matchPositionsByTitle(
  db: SqlExecutor,
  organizationId: string,
): Promise<number> {
  const { rows } = await db.query(
    `insert into position_profiles (position_id, organization_id, profile_id)
     select p.position_id, $1, j.profile_id
       from positions p join job_profiles j on lower(j.title) = lower(p.title)
      where p.ends_on is null
        and not exists (select 1 from position_profiles pp where pp.position_id = p.position_id)
     returning position_id`,
    [organizationId],
  );
  return rows.length;
}

export async function setPositionProfile(
  db: SqlExecutor,
  organizationId: string,
  positionId: string,
  profileId: string | null,
): Promise<void> {
  if (!profileId) {
    await db.query(`delete from position_profiles where position_id = $1`, [positionId]);
    return;
  }
  await db.query(
    `insert into position_profiles (position_id, organization_id, profile_id) values ($1, $2, $3)
     on conflict (position_id) do update set profile_id = $3`,
    [positionId, organizationId, profileId],
  );
}

export interface ProfileLine {
  position: number;
  indicatorId: string;
  name: string;
  formula: string;
  source: string;
  frequency: string;
  reliable: boolean;
  leading: boolean;
  targetText: string;
  thresholdText: string;
  direction: 'higher' | 'lower' | null;
  target: number | null;
  threshold: number | null;
  alertWhen: Comparison | null;
  weight: number | null;
  kind: LineKind;
  malus: Malus | null;
}

export interface Profile {
  profileId: string;
  title: string;
  category: string;
  direction: string | null;
  weights: {
    individual: number;
    collective: number;
    collectiveLabel: string | null;
    group: number;
    note: string | null;
  };
  source: string;
  lines: ProfileLine[];
  positions: string[];
}

const num = (value: string | null) => (value === null ? null : Number(value));

export async function listProfiles(db: SqlExecutor): Promise<Profile[]> {
  const [profiles, lines, positions] = await Promise.all([
    db.query<{
      profile_id: string;
      title: string;
      category: string;
      direction: string | null;
      weights: Profile['weights'];
      source: string;
    }>(`select profile_id, title, category, direction, weights, source from job_profiles
         order by direction nulls last, title`),
    db.query<{
      profile_id: string;
      position: number;
      indicator_id: string;
      name: string;
      formula: string;
      source: string;
      frequency: string;
      reliable: boolean;
      leading: boolean;
      target_text: string;
      threshold_text: string;
      direction: ProfileLine['direction'];
      target: string | null;
      threshold: string | null;
      alert_when: Comparison | null;
      weight: string | null;
      kind: LineKind;
      malus: Malus | null;
    }>(`select l.profile_id, l.position, l.indicator_id, i.name, i.formula, i.source, i.frequency,
          i.reliable, i.is_leading as leading, l.target_text, l.threshold_text, l.direction, l.target,
          l.threshold, l.alert_when, l.weight, l.kind, l.malus
         from profile_lines l join indicators i on i.indicator_id = l.indicator_id
        order by l.profile_id, l.position`),
    db.query<{ profile_id: string; position_id: string }>(
      `select profile_id, position_id from position_profiles`,
    ),
  ]);
  return profiles.rows.map((p) => ({
    profileId: p.profile_id,
    title: p.title,
    category: p.category,
    direction: p.direction,
    weights: p.weights,
    source: p.source,
    lines: lines.rows
      .filter((l) => l.profile_id === p.profile_id)
      .map((l) => ({
        position: l.position,
        indicatorId: l.indicator_id,
        name: l.name,
        formula: l.formula,
        source: l.source,
        frequency: l.frequency,
        reliable: l.reliable,
        leading: l.leading,
        targetText: l.target_text,
        thresholdText: l.threshold_text,
        direction: l.direction,
        target: num(l.target),
        threshold: num(l.threshold),
        alertWhen: l.alert_when,
        weight: num(l.weight),
        kind: l.kind,
        malus: l.malus,
      })),
    positions: positions.rows
      .filter((x) => x.profile_id === p.profile_id)
      .map((x) => x.position_id),
  }));
}

export async function setIndicatorReliable(
  db: SqlExecutor,
  indicatorId: string,
  reliable: boolean,
): Promise<boolean> {
  const { rows } = await db.query(
    `update indicators set reliable = $2 where indicator_id = $1 returning indicator_id`,
    [indicatorId, reliable],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------- quarters

export interface Quarter {
  quarterId: string;
  label: string;
  startsOn: string;
  endsOn: string;
  status: QuarterStatus;
  progressive: boolean;
  scale: Scale;
  groupFactor: number | null;
  groupTriggered: boolean;
  units: { unitId: string; factor: number }[];
}

type QuarterRow = {
  quarter_id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  status: QuarterStatus;
  progressive: boolean;
  scale: Scale;
  group_factor: string | null;
  group_triggered: boolean;
};
const quarterColumns = `quarter_id, label, to_char(starts_on, 'YYYY-MM-DD') as starts_on,
  to_char(ends_on, 'YYYY-MM-DD') as ends_on, status, progressive, scale, group_factor,
  group_triggered`;

async function withUnits(db: SqlExecutor, rows: QuarterRow[]): Promise<Quarter[]> {
  const { rows: units } = await db.query<{ quarter_id: string; unit_id: string; factor: string }>(
    `select quarter_id, unit_id, factor from quarter_units`,
  );
  return rows.map((r) => ({
    quarterId: r.quarter_id,
    label: r.label,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.status,
    progressive: r.progressive,
    scale: r.scale,
    groupFactor: num(r.group_factor),
    groupTriggered: r.group_triggered,
    units: units
      .filter((u) => u.quarter_id === r.quarter_id)
      .map((u) => ({ unitId: u.unit_id, factor: Number(u.factor) })),
  }));
}

export async function listQuarters(db: SqlExecutor): Promise<Quarter[]> {
  const { rows } = await db.query<QuarterRow>(
    `select ${quarterColumns} from performance_quarters order by starts_on desc`,
  );
  return withUnits(db, rows);
}

export async function findQuarter(
  db: SqlExecutor,
  quarterId: string,
  lock = false,
): Promise<Quarter | null> {
  const { rows } = await db.query<QuarterRow>(
    `select ${quarterColumns} from performance_quarters where quarter_id = $1
     ${lock ? 'for update' : ''}`,
    [quarterId],
  );
  return (await withUnits(db, rows))[0] ?? null;
}

export async function insertQuarter(
  db: SqlExecutor,
  organizationId: string,
  input: { label: string; startsOn: string; endsOn: string; progressive: boolean; scale: Scale },
): Promise<string> {
  const quarterId = newId('pqt');
  await db.query(
    `insert into performance_quarters (quarter_id, organization_id, label, starts_on, ends_on,
       progressive, scale)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      quarterId,
      organizationId,
      input.label,
      input.startsOn,
      input.endsOn,
      input.progressive,
      JSON.stringify(input.scale),
    ],
  );
  return quarterId;
}

export async function setQuarterStatus(
  db: SqlExecutor,
  quarterId: string,
  status: QuarterStatus,
): Promise<void> {
  const stamp = {
    draft: '',
    open: 'opened_at = now(),',
    measured: 'measured_at = now(),',
    closed: 'closed_at = now(),',
  }[status];
  await db.query(`update performance_quarters set ${stamp} status = $2 where quarter_id = $1`, [
    quarterId,
    status,
  ]);
}

export async function setUnitFactor(
  db: SqlExecutor,
  organizationId: string,
  input: { quarterId: string; unitId: string; factor: number },
): Promise<void> {
  await db.query(
    `insert into quarter_units (organization_id, quarter_id, unit_id, factor) values ($1, $2, $3, $4)
     on conflict (quarter_id, unit_id) do update set factor = $4`,
    [organizationId, input.quarterId, input.unitId, input.factor],
  );
}

export async function setGroup(
  db: SqlExecutor,
  input: { quarterId: string; factor: number; triggered: boolean },
): Promise<void> {
  await db.query(
    `update performance_quarters set group_factor = $2, group_triggered = $3 where quarter_id = $1`,
    [input.quarterId, input.factor, input.triggered],
  );
}

/** Who holds a position with a profile at a date, and that profile's lines. */
export async function holdersWithProfiles(
  db: SqlExecutor,
  asOf: string,
): Promise<{ personId: string; positionId: string; unitId: string; profileId: string }[]> {
  const { rows } = await db.query<{
    person_id: string;
    position_id: string;
    unit_id: string;
    profile_id: string;
  }>(
    `select distinct a.person_id, a.position_id, po.unit_id, pp.profile_id
       from assignments a
       join positions po on po.position_id = a.position_id
       join position_profiles pp on pp.position_id = a.position_id
      where a.kind in ('primary', 'interim')
        and a.starts_on <= $1::date and (a.ends_on is null or a.ends_on >= $1::date)`,
    [asOf],
  );
  return rows.map((r) => ({
    personId: r.person_id,
    positionId: r.position_id,
    unitId: r.unit_id,
    profileId: r.profile_id,
  }));
}

// ---------------------------------------------------------------- reviews

export interface ReviewLineRow {
  position: number;
  name: string;
  formula: string;
  source: string;
  frequency: string;
  reliable: boolean;
  targetText: string;
  thresholdText: string;
  direction: 'higher' | 'lower' | null;
  target: number | null;
  threshold: number | null;
  alertWhen: Comparison | null;
  weight: number | null;
  kind: LineKind;
  malus: Malus | null;
  value: number | null;
  colour: Colour | null;
  proof: string | null;
  measuredAt: string | null;
}

export interface Review {
  reviewId: string;
  quarterId: string;
  personId: string;
  personName: string;
  positionId: string;
  positionTitle: string;
  unitId: string;
  managerPersonId: string | null;
  managerName: string | null;
  profileTitle: string;
  weights: Profile['weights'];
  status: ReviewStatus;
  acknowledgedAt: string | null;
  record: { facts?: string; difficulties?: string; support?: string; protocols?: number | null };
  managerSignedAt: string | null;
  personObservations: string | null;
  personSignedAt: string | null;
  validatedAt: string | null;
  individual: number | null;
  collective: number | null;
  group: number | null;
  factor: number | null;
  fallback: boolean;
  lines: ReviewLineRow[];
}

export async function insertReview(
  db: SqlExecutor,
  organizationId: string,
  input: {
    quarterId: string;
    personId: string;
    positionId: string;
    unitId: string;
    managerPersonId: string | null;
    profile: Profile;
  },
): Promise<string> {
  const reviewId = newId('rvw');
  await db.query(
    `insert into reviews (review_id, organization_id, quarter_id, person_id, position_id, unit_id,
       manager_person_id, profile_title, weights)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      reviewId,
      organizationId,
      input.quarterId,
      input.personId,
      input.positionId,
      input.unitId,
      input.managerPersonId,
      input.profile.title,
      JSON.stringify(input.profile.weights),
    ],
  );
  // The grid is frozen as it is now: the quarter's rules never change while it runs.
  for (const line of input.profile.lines) {
    await db.query(
      `insert into review_lines (organization_id, review_id, position, name, formula, source,
         frequency, reliable, target_text, threshold_text, direction, target, threshold,
         alert_when, weight, kind, malus)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        organizationId,
        reviewId,
        line.position,
        line.name,
        line.formula,
        line.source,
        line.frequency,
        line.reliable,
        line.targetText,
        line.thresholdText,
        line.direction,
        line.target,
        line.threshold,
        line.alertWhen,
        line.weight,
        line.kind,
        line.malus ? JSON.stringify(line.malus) : null,
      ],
    );
  }
  return reviewId;
}

const reviewColumns = `r.review_id, r.quarter_id, r.person_id, pe.name as person_name, r.position_id,
  po.title as position_title, r.unit_id, r.manager_person_id, ma.name as manager_name,
  r.profile_title, r.weights, r.status, r.acknowledged_at, r.record, r.manager_signed_at,
  r.person_observations, r.person_signed_at, r.validated_at, r.individual, r.collective,
  r.group_part, r.factor, r.fallback`;
const reviewJoins = `from reviews r
  join people pe on pe.person_id = r.person_id
  join positions po on po.position_id = r.position_id
  left join people ma on ma.person_id = r.manager_person_id`;

type ReviewRow = {
  review_id: string;
  quarter_id: string;
  person_id: string;
  person_name: string;
  position_id: string;
  position_title: string;
  unit_id: string;
  manager_person_id: string | null;
  manager_name: string | null;
  profile_title: string;
  weights: Profile['weights'];
  status: ReviewStatus;
  acknowledged_at: Date | null;
  record: Review['record'];
  manager_signed_at: Date | null;
  person_observations: string | null;
  person_signed_at: Date | null;
  validated_at: Date | null;
  individual: string | null;
  collective: string | null;
  group_part: string | null;
  factor: string | null;
  fallback: boolean;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function hydrate(db: SqlExecutor, rows: ReviewRow[], withLines: boolean): Promise<Review[]> {
  const lines =
    withLines && rows.length > 0
      ? (
          await db.query<{
            review_id: string;
            position: number;
            name: string;
            formula: string;
            source: string;
            frequency: string;
            reliable: boolean;
            target_text: string;
            threshold_text: string;
            direction: ReviewLineRow['direction'];
            target: string | null;
            threshold: string | null;
            alert_when: Comparison | null;
            weight: string | null;
            kind: LineKind;
            malus: Malus | null;
            value: string | null;
            colour: Colour | null;
            proof: string | null;
            measured_at: Date | null;
          }>(
            `select review_id, position, name, formula, source, frequency, reliable, target_text,
             threshold_text, direction, target, threshold, alert_when, weight, kind, malus, value,
             colour, proof, measured_at
             from review_lines where review_id = any($1::text[]) order by review_id, position`,
            [rows.map((r) => r.review_id)],
          )
        ).rows
      : [];
  return rows.map((r) => ({
    reviewId: r.review_id,
    quarterId: r.quarter_id,
    personId: r.person_id,
    personName: r.person_name,
    positionId: r.position_id,
    positionTitle: r.position_title,
    unitId: r.unit_id,
    managerPersonId: r.manager_person_id,
    managerName: r.manager_name,
    profileTitle: r.profile_title,
    weights: r.weights,
    status: r.status,
    acknowledgedAt: iso(r.acknowledged_at),
    record: r.record,
    managerSignedAt: iso(r.manager_signed_at),
    personObservations: r.person_observations,
    personSignedAt: iso(r.person_signed_at),
    validatedAt: iso(r.validated_at),
    individual: num(r.individual),
    collective: num(r.collective),
    group: num(r.group_part),
    factor: num(r.factor),
    fallback: r.fallback,
    lines: lines
      .filter((l) => l.review_id === r.review_id)
      .map((l) => ({
        position: l.position,
        name: l.name,
        formula: l.formula,
        source: l.source,
        frequency: l.frequency,
        reliable: l.reliable,
        targetText: l.target_text,
        thresholdText: l.threshold_text,
        direction: l.direction,
        target: num(l.target),
        threshold: num(l.threshold),
        alertWhen: l.alert_when,
        weight: num(l.weight),
        kind: l.kind,
        malus: l.malus,
        value: num(l.value),
        colour: l.colour,
        proof: l.proof,
        measuredAt: iso(l.measured_at),
      })),
  }));
}

export async function findReview(
  db: SqlExecutor,
  reviewId: string,
  lock = false,
): Promise<Review | null> {
  const { rows } = await db.query<ReviewRow>(
    `select ${reviewColumns} ${reviewJoins} where r.review_id = $1 ${lock ? 'for update of r' : ''}`,
    [reviewId],
  );
  return (await hydrate(db, rows, true))[0] ?? null;
}

export async function listReviews(
  db: SqlExecutor,
  filter: { quarterId?: string; personId?: string; managerPersonId?: string },
  withLines = false,
): Promise<Review[]> {
  const { rows } = await db.query<ReviewRow>(
    `select ${reviewColumns} ${reviewJoins}
      where ($1::text is null or r.quarter_id = $1)
        and ($2::text is null or r.person_id = $2)
        and ($3::text is null or r.manager_person_id = $3)
      order by pe.name`,
    [filter.quarterId ?? null, filter.personId ?? null, filter.managerPersonId ?? null],
  );
  return hydrate(db, rows, withLines);
}

export async function writeLine(
  db: SqlExecutor,
  reviewId: string,
  position: number,
  input: { value: number | null; colour: Colour | null; proof: string | null },
): Promise<boolean> {
  const { rows } = await db.query(
    `update review_lines set value = $3, colour = $4, proof = $5, measured_at = now()
      where review_id = $1 and position = $2 returning position`,
    [reviewId, position, input.value, input.colour, input.proof],
  );
  return rows.length > 0;
}

export async function updateReview(
  db: SqlExecutor,
  reviewId: string,
  fields: Partial<{
    status: ReviewStatus;
    acknowledged: boolean;
    record: Review['record'];
    managerSignedBy: string;
    personObservations: string | null;
    personSigned: boolean;
    validatedBy: string;
    individual: number;
    collective: number | null;
    group: number | null;
    factor: number;
    fallback: boolean;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [reviewId];
  const add = (sql: string, value?: unknown) => {
    if (value === undefined) {
      sets.push(sql);
      return;
    }
    values.push(value);
    sets.push(sql.replace('?', `$${values.length}`));
  };
  if (fields.status) add('status = ?', fields.status);
  if (fields.acknowledged) add('acknowledged_at = coalesce(acknowledged_at, now())');
  if (fields.record) add('record = ?', JSON.stringify(fields.record));
  if (fields.managerSignedBy) {
    add('manager_signed_by = ?', fields.managerSignedBy);
    add('manager_signed_at = now()');
  }
  if (fields.personObservations !== undefined)
    add('person_observations = ?', fields.personObservations);
  if (fields.personSigned) add('person_signed_at = now()');
  if (fields.validatedBy) {
    add('validated_by = ?', fields.validatedBy);
    add('validated_at = now()');
  }
  if (fields.individual !== undefined) add('individual = ?', fields.individual);
  if (fields.collective !== undefined) add('collective = ?', fields.collective);
  if (fields.group !== undefined) add('group_part = ?', fields.group);
  if (fields.factor !== undefined) add('factor = ?', fields.factor);
  if (fields.fallback !== undefined) add('fallback = ?', fields.fallback);
  if (sets.length === 0) return;
  await db.query(`update reviews set ${sets.join(', ')} where review_id = $1`, values);
}

/** The person's last validated factors, newest first: the fallback without a review. */
export async function previousFactors(
  db: SqlExecutor,
  personId: string,
  beforeQuarterStart: string,
): Promise<number[]> {
  const { rows } = await db.query<{ factor: string }>(
    `select r.factor from reviews r join performance_quarters q on q.quarter_id = r.quarter_id
      where r.person_id = $1 and r.status = 'validated' and r.factor is not null
        and q.ends_on < $2::date
      order by q.ends_on desc limit 2`,
    [personId, beforeQuarterStart],
  );
  return rows.map((r) => Number(r.factor));
}

/** The unit and every unit above it, nearest first: where a collective factor is looked for. */
export async function unitsUpward(db: SqlExecutor, unitId: string): Promise<string[]> {
  const { rows } = await db.query<{ unit_id: string }>(
    `with recursive up as (
       select unit_id, parent_id, 0 as depth from units where unit_id = $1
       union all
       select u.unit_id, u.parent_id, up.depth + 1 from units u join up on u.unit_id = up.parent_id
     )
     select unit_id from up order by depth`,
    [unitId],
  );
  return rows.map((r) => r.unit_id);
}
