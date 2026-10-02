import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type {
  Assignment,
  AssignmentKind,
  Person,
  Position,
  Unit,
  UnitType,
} from '../structure.record.js';

/**
 * The structure's tables, each with its row-level security in the same migration (constitution V).
 * Foreign keys carry the organization, so no row can point into another organization. Nothing is
 * deleted: units, positions and assignments close at a date, and the past stays readable.
 */
export function structureMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  const dated = `starts_on date not null default current_date,
  ends_on date,
  check (ends_on is null or ends_on >= starts_on)`;
  return `
create table ${s}.unit_types (
  unit_type_id text primary key,
  organization_id text not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (length(name) between 1 and 160),
  legal_entity boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, key),
  unique (organization_id, unit_type_id)
);
${policy('unit_types')}

create table ${s}.units (
  unit_id text primary key,
  organization_id text not null,
  unit_type_id text not null,
  parent_id text,
  name text not null check (length(name) between 1 and 160),
  code text,
  country text check (country ~ '^[A-Z]{2}$'),
  ${dated},
  created_at timestamptz not null default now(),
  unique (organization_id, unit_id),
  foreign key (organization_id, unit_type_id) references ${s}.unit_types (organization_id, unit_type_id),
  foreign key (organization_id, parent_id) references ${s}.units (organization_id, unit_id)
);
create index units_parent on ${s}.units (organization_id, parent_id);
${policy('units')}

create table ${s}.positions (
  position_id text primary key,
  organization_id text not null,
  unit_id text not null,
  title text not null check (length(title) between 1 and 160),
  reports_to text,
  ${dated},
  created_at timestamptz not null default now(),
  unique (organization_id, position_id),
  foreign key (organization_id, unit_id) references ${s}.units (organization_id, unit_id),
  foreign key (organization_id, reports_to) references ${s}.positions (organization_id, position_id)
);
create index positions_unit on ${s}.positions (organization_id, unit_id);
${policy('positions')}

create table ${s}.people (
  person_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 160),
  email text,
  phone text,
  account_user_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, person_id),
  unique (organization_id, account_user_id)
);
${policy('people')}

create table ${s}.assignments (
  assignment_id text primary key,
  organization_id text not null,
  person_id text not null,
  position_id text not null,
  kind text not null check (kind in ('primary', 'functional', 'project', 'interim', 'delegation')),
  starts_on date not null,
  ends_on date,
  check (ends_on is null or ends_on >= starts_on),
  created_at timestamptz not null default now(),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id),
  foreign key (organization_id, position_id) references ${s}.positions (organization_id, position_id)
);
create index assignments_person on ${s}.assignments (organization_id, person_id);
create index assignments_position on ${s}.assignments (organization_id, position_id);
${policy('assignments')}

grant select, insert, update on ${s}.unit_types, ${s}.units, ${s}.positions, ${s}.people,
  ${s}.assignments to ${options.appRole};
`;
}

const dates = `to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on`;
/** Rows that exist at a date. */
const activeAt = `starts_on <= $1::date and (ends_on is null or ends_on >= $1::date)`;

type UnitTypeRow = {
  unit_type_id: string;
  key: string;
  name: string;
  legal_entity: boolean;
};
type UnitRow = {
  unit_id: string;
  unit_type_id: string;
  parent_id: string | null;
  name: string;
  code: string | null;
  country: string | null;
  starts_on: string;
  ends_on: string | null;
};
type PositionRow = {
  position_id: string;
  unit_id: string;
  title: string;
  reports_to: string | null;
  starts_on: string;
  ends_on: string | null;
};
type PersonRow = {
  person_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  account_user_id: string | null;
};
type AssignmentRow = {
  assignment_id: string;
  person_id: string;
  position_id: string;
  kind: AssignmentKind;
  starts_on: string;
  ends_on: string | null;
};

const toUnitType = (r: UnitTypeRow): UnitType => ({
  unitTypeId: r.unit_type_id,
  key: r.key,
  name: r.name,
  legalEntity: r.legal_entity,
});
const toUnit = (r: UnitRow): Unit => ({
  unitId: r.unit_id,
  unitTypeId: r.unit_type_id,
  parentId: r.parent_id,
  name: r.name,
  code: r.code,
  country: r.country,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
});
const toPosition = (r: PositionRow): Position => ({
  positionId: r.position_id,
  unitId: r.unit_id,
  title: r.title,
  reportsTo: r.reports_to,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
});
const toPerson = (r: PersonRow): Person => ({
  personId: r.person_id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  accountUserId: r.account_user_id,
});
const toAssignment = (r: AssignmentRow): Assignment => ({
  assignmentId: r.assignment_id,
  personId: r.person_id,
  positionId: r.position_id,
  kind: r.kind,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
});

export async function insertUnitType(
  db: SqlExecutor,
  organizationId: string,
  input: { key: string; name: string; legalEntity: boolean },
): Promise<UnitType> {
  const { rows } = await db.query<UnitTypeRow>(
    `insert into unit_types (unit_type_id, organization_id, key, name, legal_entity)
     values ($1, $2, $3, $4, $5) returning unit_type_id, key, name, legal_entity`,
    [newId('utp'), organizationId, input.key, input.name, input.legalEntity],
  );
  return toUnitType(rows[0] as UnitTypeRow);
}

export async function insertUnit(
  db: SqlExecutor,
  organizationId: string,
  input: {
    unitTypeId: string;
    parentId?: string | undefined;
    name: string;
    code?: string | undefined;
    country?: string | undefined;
    startsOn?: string | undefined;
  },
): Promise<Unit> {
  const { rows } = await db.query<UnitRow>(
    `insert into units (unit_id, organization_id, unit_type_id, parent_id, name, code, country, starts_on)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::date, current_date))
     returning unit_id, unit_type_id, parent_id, name, code, country, ${dates}`,
    [
      newId('unt'),
      organizationId,
      input.unitTypeId,
      input.parentId ?? null,
      input.name,
      input.code ?? null,
      input.country ?? null,
      input.startsOn ?? null,
    ],
  );
  return toUnit(rows[0] as UnitRow);
}

export async function findUnit(db: SqlExecutor, unitId: string): Promise<Unit | null> {
  const { rows } = await db.query<UnitRow>(
    `select unit_id, unit_type_id, parent_id, name, code, country, ${dates}
       from units where unit_id = $1`,
    [unitId],
  );
  return rows[0] ? toUnit(rows[0]) : null;
}

/** The unit and every unit above it, from the unit up to the top. */
export async function ancestorsOf(db: SqlExecutor, unitId: string): Promise<string[]> {
  const { rows } = await db.query<{ unit_id: string }>(
    `with recursive up as (
       select unit_id, parent_id, 0 as depth from units where unit_id = $1
       union all
       select u.unit_id, u.parent_id, up.depth + 1 from units u join up on u.unit_id = up.parent_id
     )
     select unit_id from up order by depth`,
    [unitId],
  );
  return rows.map((row) => row.unit_id);
}

export async function setUnitParent(
  db: SqlExecutor,
  unitId: string,
  parentId: string | null,
): Promise<void> {
  await db.query(`update units set parent_id = $2 where unit_id = $1`, [unitId, parentId]);
}

export async function closeUnit(db: SqlExecutor, unitId: string, endsOn: string): Promise<void> {
  await db.query(`update units set ends_on = $2 where unit_id = $1`, [unitId, endsOn]);
}

export async function insertPosition(
  db: SqlExecutor,
  organizationId: string,
  input: {
    unitId: string;
    title: string;
    reportsTo?: string | undefined;
    startsOn?: string | undefined;
  },
): Promise<Position> {
  const { rows } = await db.query<PositionRow>(
    `insert into positions (position_id, organization_id, unit_id, title, reports_to, starts_on)
     values ($1, $2, $3, $4, $5, coalesce($6::date, current_date))
     returning position_id, unit_id, title, reports_to, ${dates}`,
    [
      newId('pos'),
      organizationId,
      input.unitId,
      input.title,
      input.reportsTo ?? null,
      input.startsOn ?? null,
    ],
  );
  return toPosition(rows[0] as PositionRow);
}

export async function findPosition(db: SqlExecutor, positionId: string): Promise<Position | null> {
  const { rows } = await db.query<PositionRow>(
    `select position_id, unit_id, title, reports_to, ${dates} from positions where position_id = $1`,
    [positionId],
  );
  return rows[0] ? toPosition(rows[0]) : null;
}

export async function closePosition(
  db: SqlExecutor,
  positionId: string,
  endsOn: string,
): Promise<void> {
  await db.query(`update positions set ends_on = $2 where position_id = $1`, [positionId, endsOn]);
}

export async function insertPerson(
  db: SqlExecutor,
  organizationId: string,
  input: {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    accountUserId?: string | undefined;
  },
): Promise<Person> {
  const { rows } = await db.query<PersonRow>(
    `insert into people (person_id, organization_id, name, email, phone, account_user_id)
     values ($1, $2, $3, $4, $5, $6)
     returning person_id, name, email, phone, account_user_id`,
    [
      newId('prs'),
      organizationId,
      input.name,
      input.email ?? null,
      input.phone ?? null,
      input.accountUserId ?? null,
    ],
  );
  return toPerson(rows[0] as PersonRow);
}

/** Locks the person's row, so two assignments of the same person never race. */
export async function lockPerson(db: SqlExecutor, personId: string): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>(
    `select person_id, name, email, phone, account_user_id from people where person_id = $1
       for update`,
    [personId],
  );
  return rows[0] ? toPerson(rows[0]) : null;
}

/** The person's primary assignments that overlap the period. */
export async function overlappingPrimary(
  db: SqlExecutor,
  personId: string,
  startsOn: string,
  endsOn: string | null,
): Promise<string[]> {
  const { rows } = await db.query<{ assignment_id: string }>(
    `select assignment_id from assignments
      where person_id = $1 and kind = 'primary'
        and daterange(starts_on, ends_on, '[]') && daterange($2::date, $3::date, '[]')`,
    [personId, startsOn, endsOn],
  );
  return rows.map((row) => row.assignment_id);
}

export async function insertAssignment(
  db: SqlExecutor,
  organizationId: string,
  input: {
    personId: string;
    positionId: string;
    kind: AssignmentKind;
    startsOn: string;
    endsOn?: string | undefined;
  },
): Promise<Assignment> {
  const { rows } = await db.query<AssignmentRow>(
    `insert into assignments (assignment_id, organization_id, person_id, position_id, kind,
       starts_on, ends_on)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning assignment_id, person_id, position_id, kind, ${dates}`,
    [
      newId('asg'),
      organizationId,
      input.personId,
      input.positionId,
      input.kind,
      input.startsOn,
      input.endsOn ?? null,
    ],
  );
  return toAssignment(rows[0] as AssignmentRow);
}

export async function findAssignment(
  db: SqlExecutor,
  assignmentId: string,
): Promise<Assignment | null> {
  const { rows } = await db.query<AssignmentRow>(
    `select assignment_id, person_id, position_id, kind, ${dates}
       from assignments where assignment_id = $1`,
    [assignmentId],
  );
  return rows[0] ? toAssignment(rows[0]) : null;
}

export async function endAssignment(
  db: SqlExecutor,
  assignmentId: string,
  endsOn: string,
): Promise<void> {
  await db.query(`update assignments set ends_on = $2 where assignment_id = $1`, [
    assignmentId,
    endsOn,
  ]);
}

/** Everything that exists at a date (people are listed whatever the date). */
export async function readChart(db: SqlExecutor, asOf: string) {
  const [unitTypes, units, positions, people, assignments] = await Promise.all([
    db.query<UnitTypeRow>(
      `select unit_type_id, key, name, legal_entity from unit_types order by name`,
    ),
    db.query<UnitRow>(
      `select unit_id, unit_type_id, parent_id, name, code, country, ${dates}
         from units where ${activeAt} order by name`,
      [asOf],
    ),
    db.query<PositionRow>(
      `select position_id, unit_id, title, reports_to, ${dates}
         from positions where ${activeAt} order by title`,
      [asOf],
    ),
    db.query<PersonRow>(
      `select person_id, name, email, phone, account_user_id from people order by name`,
    ),
    db.query<AssignmentRow>(
      `select assignment_id, person_id, position_id, kind, ${dates}
         from assignments where ${activeAt} order by starts_on`,
      [asOf],
    ),
  ]);
  return {
    unitTypes: unitTypes.rows.map(toUnitType),
    units: units.rows.map(toUnit),
    positions: positions.rows.map(toPosition),
    people: people.rows.map(toPerson),
    assignments: assignments.rows.map(toAssignment),
  };
}

/** The unit a position belongs to, for checking rights on it. */
export async function unitOfPosition(db: SqlExecutor, positionId: string): Promise<string | null> {
  const { rows } = await db.query<{ unit_id: string }>(
    `select unit_id from positions where position_id = $1`,
    [positionId],
  );
  return rows[0]?.unit_id ?? null;
}

/** The unit of an assignment's position, for checking rights on it. */
export async function unitOfAssignment(
  db: SqlExecutor,
  assignmentId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ unit_id: string }>(
    `select p.unit_id from assignments a join positions p on p.position_id = a.position_id
      where a.assignment_id = $1`,
    [assignmentId],
  );
  return rows[0]?.unit_id ?? null;
}

export async function findPerson(db: SqlExecutor, personId: string): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>(
    `select person_id, name, email, phone, account_user_id from people where person_id = $1`,
    [personId],
  );
  return rows[0] ? toPerson(rows[0]) : null;
}

/** The person whose account this is, if any. */
export async function personOfAccount(
  db: SqlExecutor,
  accountUserId: string,
): Promise<Person | null> {
  const { rows } = await db.query<PersonRow>(
    `select person_id, name, email, phone, account_user_id from people where account_user_id = $1`,
    [accountUserId],
  );
  return rows[0] ? toPerson(rows[0]) : null;
}

/** The people without an account who carry this e-mail (case does not count). */
export async function unlinkedPeopleWithEmail(db: SqlExecutor, email: string): Promise<Person[]> {
  const { rows } = await db.query<PersonRow>(
    `select person_id, name, email, phone, account_user_id from people
      where lower(email) = lower($1) and account_user_id is null`,
    [email],
  );
  return rows.map(toPerson);
}

export async function setPersonAccount(
  db: SqlExecutor,
  personId: string,
  accountUserId: string | null,
): Promise<void> {
  await db.query(`update people set account_user_id = $2 where person_id = $1`, [
    personId,
    accountUserId,
  ]);
}

export async function updatePersonRow(
  db: SqlExecutor,
  personId: string,
  input: {
    name?: string | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
  },
): Promise<Person> {
  const { rows } = await db.query<PersonRow>(
    `update people set
       name = coalesce($2, name),
       email = case when $3::boolean then $4 else email end,
       phone = case when $5::boolean then $6 else phone end
     where person_id = $1
     returning person_id, name, email, phone, account_user_id`,
    [
      personId,
      input.name ?? null,
      input.email !== undefined,
      input.email ?? null,
      input.phone !== undefined,
      input.phone ?? null,
    ],
  );
  return toPerson(rows[0] as PersonRow);
}

/** The positions and their holders at a date, to find who reports to whom. */
export async function holdersAt(
  db: SqlExecutor,
  asOf: string,
): Promise<{ positionId: string; reportsTo: string | null; personId: string | null }[]> {
  const { rows } = await db.query<{
    position_id: string;
    reports_to: string | null;
    person_id: string | null;
  }>(
    `select p.position_id, p.reports_to, a.person_id
       from positions p
       left join assignments a on a.position_id = p.position_id
        and a.starts_on <= $1::date and (a.ends_on is null or a.ends_on >= $1::date)
        and a.kind in ('primary', 'interim')
      where p.starts_on <= $1::date and (p.ends_on is null or p.ends_on >= $1::date)`,
    [asOf],
  );
  return rows.map((r) => ({
    positionId: r.position_id,
    reportsTo: r.reports_to,
    personId: r.person_id,
  }));
}
