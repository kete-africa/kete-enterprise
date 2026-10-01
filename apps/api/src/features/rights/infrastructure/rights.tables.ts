import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { Grant, Reach, Role } from '../rights.record.js';

/** Roles and their grants, with row-level security in the same migration (constitution V). */
export function rightsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.roles (
  role_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 120),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (organization_id, role_id),
  unique (organization_id, name)
);
${policy('roles')}

create table ${s}.role_grants (
  grant_id text primary key,
  organization_id text not null,
  role_id text not null,
  position_id text,
  person_id text,
  scope_unit_id text,
  scope_country text check (scope_country ~ '^[A-Z]{2}$'),
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check ((position_id is null) <> (person_id is null)),
  check (scope_unit_id is null or scope_country is null),
  foreign key (organization_id, role_id) references ${s}.roles (organization_id, role_id),
  foreign key (organization_id, position_id) references ${s}.positions (organization_id, position_id),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id),
  foreign key (organization_id, scope_unit_id) references ${s}.units (organization_id, unit_id)
);
create index role_grants_position on ${s}.role_grants (organization_id, position_id);
create index role_grants_person on ${s}.role_grants (organization_id, person_id);
${policy('role_grants')}

grant select, insert, update on ${s}.roles, ${s}.role_grants to ${options.appRole};
`;
}

type RoleRow = { role_id: string; name: string; permissions: string[] };
type GrantRow = {
  grant_id: string;
  role_id: string;
  position_id: string | null;
  person_id: string | null;
  scope_unit_id: string | null;
  scope_country: string | null;
  starts_on: string;
  ends_on: string | null;
};

const toRole = (r: RoleRow): Role => ({
  roleId: r.role_id,
  name: r.name,
  permissions: r.permissions,
});
const toGrant = (r: GrantRow): Grant => ({
  grantId: r.grant_id,
  roleId: r.role_id,
  positionId: r.position_id,
  personId: r.person_id,
  scopeUnitId: r.scope_unit_id,
  scopeCountry: r.scope_country,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
});
const grantColumns = `grant_id, role_id, position_id, person_id, scope_unit_id, scope_country,
  to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on`;

export async function insertRole(
  db: SqlExecutor,
  organizationId: string,
  input: { name: string; permissions: string[] },
): Promise<Role> {
  const { rows } = await db.query<RoleRow>(
    `insert into roles (role_id, organization_id, name, permissions) values ($1, $2, $3, $4)
     returning role_id, name, permissions`,
    [newId('rol'), organizationId, input.name, [...new Set(input.permissions)].sort()],
  );
  return toRole(rows[0] as RoleRow);
}

export async function findRole(db: SqlExecutor, roleId: string): Promise<Role | null> {
  const { rows } = await db.query<RoleRow>(
    `select role_id, name, permissions from roles where role_id = $1`,
    [roleId],
  );
  return rows[0] ? toRole(rows[0]) : null;
}

export async function setRolePermissions(
  db: SqlExecutor,
  roleId: string,
  permissions: string[],
): Promise<void> {
  await db.query(`update roles set permissions = $2 where role_id = $1`, [
    roleId,
    [...new Set(permissions)].sort(),
  ]);
}

export async function insertGrant(
  db: SqlExecutor,
  organizationId: string,
  input: {
    roleId: string;
    positionId?: string | undefined;
    personId?: string | undefined;
    scopeUnitId?: string | undefined;
    scopeCountry?: string | undefined;
    startsOn?: string | undefined;
    endsOn?: string | undefined;
  },
): Promise<Grant> {
  const { rows } = await db.query<GrantRow>(
    `insert into role_grants (grant_id, organization_id, role_id, position_id, person_id,
       scope_unit_id, scope_country, starts_on, ends_on)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::date, current_date), $9)
     returning ${grantColumns}`,
    [
      newId('grt'),
      organizationId,
      input.roleId,
      input.positionId ?? null,
      input.personId ?? null,
      input.scopeUnitId ?? null,
      input.scopeCountry ?? null,
      input.startsOn ?? null,
      input.endsOn ?? null,
    ],
  );
  return toGrant(rows[0] as GrantRow);
}

export async function findGrant(db: SqlExecutor, grantId: string): Promise<Grant | null> {
  const { rows } = await db.query<GrantRow>(
    `select ${grantColumns} from role_grants where grant_id = $1`,
    [grantId],
  );
  return rows[0] ? toGrant(rows[0]) : null;
}

export async function endGrant(db: SqlExecutor, grantId: string, endsOn: string): Promise<void> {
  await db.query(`update role_grants set ends_on = $2 where grant_id = $1`, [grantId, endsOn]);
}

export async function listRoles(db: SqlExecutor): Promise<Role[]> {
  const { rows } = await db.query<RoleRow>(
    `select role_id, name, permissions from roles order by name`,
  );
  return rows.map(toRole);
}

export async function listGrants(db: SqlExecutor, asOf: string): Promise<Grant[]> {
  const { rows } = await db.query<GrantRow>(
    `select ${grantColumns} from role_grants
      where starts_on <= $1::date and (ends_on is null or ends_on >= $1::date)
      order by starts_on`,
    [asOf],
  );
  return rows.map(toGrant);
}

/**
 * Where the person (by her Compte Kete account) holds `permission` at `asOf`: through grants to her,
 * or to a position she holds then (any kind of assignment, so an interim or a delegation carries
 * the position's rights for its period). A unit scope covers its whole subtree; a country scope
 * covers the units of that country and everything under them.
 */
export async function reachOf(
  db: SqlExecutor,
  accountUserId: string,
  permission: string,
  asOf: string,
): Promise<Reach> {
  const { rows } = await db.query<{ everywhere: boolean; units: string[] }>(
    `with recursive
       me as (select person_id from people where account_user_id = $1),
       held as (
         select a.position_id from assignments a join me on a.person_id = me.person_id
          where a.starts_on <= $3::date and (a.ends_on is null or a.ends_on >= $3::date)
       ),
       mine as (
         select g.scope_unit_id, g.scope_country
           from role_grants g join roles r on r.role_id = g.role_id
          where $2 = any(r.permissions)
            and g.starts_on <= $3::date and (g.ends_on is null or g.ends_on >= $3::date)
            and (g.person_id in (select person_id from me)
                 or g.position_id in (select position_id from held))
       ),
       roots as (
         select scope_unit_id as unit_id from mine where scope_unit_id is not null
         union
         select u.unit_id from units u join mine on u.country = mine.scope_country
       ),
       covered as (
         select unit_id from roots
         union
         select u.unit_id from units u join covered c on u.parent_id = c.unit_id
       )
     select exists (select 1 from mine where scope_unit_id is null and scope_country is null)
              as everywhere,
            coalesce(array(select unit_id from covered), '{}') as units`,
    [accountUserId, permission, asOf],
  );
  const row = rows[0];
  return { everywhere: row?.everywhere ?? false, units: new Set(row?.units ?? []) };
}

/** The units where the person holds a position at `asOf`: what anyone sees of the structure. */
export async function ownUnits(
  db: SqlExecutor,
  accountUserId: string,
  asOf: string,
): Promise<Set<string>> {
  const { rows } = await db.query<{ unit_id: string }>(
    `select distinct p.unit_id
       from assignments a
       join people pe on pe.person_id = a.person_id
       join positions p on p.position_id = a.position_id
      where pe.account_user_id = $1
        and a.starts_on <= $2::date and (a.ends_on is null or a.ends_on >= $2::date)`,
    [accountUserId, asOf],
  );
  return new Set(rows.map((row) => row.unit_id));
}
