import { validateObject, type KeteObject } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { IdentityVariables } from '../../platform/identity.js';
import { projectIdsOf } from '../projects/index.js';
import { listResources } from '../registry/index.js';
import { isAdministrator, reach, unitsOfPerson } from '../rights/index.js';
import { CENTER, isClosed, kindsOf, stateLabel, type Kind } from './kinds.js';

// The objects at the center (spec 100; doctrine D-062, R1, R2, R15; ADR 0014): one index of every
// object that matters — the center's references and the apps' objects — with what finds, cites,
// filters and rights them: title, state, the four axes, named links. Never an app's data: the
// reader reads it at the app, with her own rights. The center's references keep their row by
// triggers; an app says its objects with its own token.

type Identity = IdentityVariables['identity'];

export function objectsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.kete_objects (
  organization_id text not null,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  object_id text not null check (length(object_id) between 1 and 128),
  -- Its owner: 'center', or the app's product.
  product text not null check (length(product) between 1 and 80),
  title text not null check (length(title) between 1 and 200),
  state text check (length(state) <= 41),
  closed boolean not null default false,
  project_id text,
  party_id text,
  unit_id text,
  person_id text,
  href text check (length(href) <= 600),
  -- When its owner last changed it: an older saying never replaces a newer one.
  said_at timestamptz not null default now(),
  indexed_at timestamptz not null default now(),
  primary key (organization_id, kind, object_id)
);
create index kete_objects_project on ${s}.kete_objects (organization_id, project_id) where project_id is not null;
create index kete_objects_party on ${s}.kete_objects (organization_id, party_id) where party_id is not null;
create index kete_objects_unit on ${s}.kete_objects (organization_id, unit_id) where unit_id is not null;
create index kete_objects_person on ${s}.kete_objects (organization_id, person_id) where person_id is not null;
${policy('kete_objects')}
grant select, insert, update, delete on ${s}.kete_objects to ${options.appRole};

-- Its named links, said by the object they leave from.
create table ${s}.object_links (
  organization_id text not null,
  from_kind text not null,
  from_id text not null,
  relation text not null check (relation ~ '^[a-z][a-z0-9_]{1,40}$'),
  to_kind text not null,
  to_id text not null,
  product text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, from_kind, from_id, relation, to_kind, to_id)
);
create index object_links_to on ${s}.object_links (organization_id, to_kind, to_id);
${policy('object_links')}
grant select, insert, delete on ${s}.object_links to ${options.appRole};

-- Places (D-056): a site, an office, a warehouse — where things are.
create table ${s}.places (
  organization_id text not null,
  place_id text not null,
  name text not null check (length(name) between 1 and 160),
  -- What kind of place, as the organization names it: « site », « entrepôt ».
  subtype text check (length(subtype) <= 60),
  address text check (length(address) <= 400),
  latitude numeric check (latitude between -90 and 90),
  longitude numeric check (longitude between -180 and 180),
  unit_id text,
  party_id text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, place_id)
);
${policy('places')}
grant select, insert, update on ${s}.places to ${options.appRole};

-- Assets (D-056): what the organization installs or owns and keeps for years — a solar plant, a
-- pump, a vehicle, a machine. Born of a project, it lives on after it.
create table ${s}.assets (
  organization_id text not null,
  asset_id text not null,
  name text not null check (length(name) between 1 and 160),
  -- What kind of asset, as the organization names it: « mini-centrale », « pompe ».
  subtype text check (length(subtype) <= 60),
  state text not null default 'in_service'
    check (state in ('in_service', 'alert', 'maintenance', 'out_of_service', 'retired')),
  party_id text,
  project_id text,
  unit_id text,
  holder_user_id text,
  place_id text,
  serial text check (length(serial) <= 120),
  commissioned_on date,
  warranty_until date,
  -- Its own figures, as the organization keeps them: « Puissance · 24 kWc ».
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array' and jsonb_array_length(facts) <= 20),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, asset_id),
  foreign key (organization_id, place_id) references ${s}.places (organization_id, place_id)
);
create index assets_project on ${s}.assets (organization_id, project_id) where project_id is not null;
${policy('assets')}
grant select, insert, update on ${s}.assets to ${options.appRole};

-- The center's references keep their row in the index by themselves.
create function ${s}.kete_objects_put(
  org text, k text, id text, t text, st text, cl boolean,
  prj text, pty text, unt text, per text, h text
) returns void language sql as $f$
  insert into ${s}.kete_objects (organization_id, kind, object_id, product, title, state, closed,
    project_id, party_id, unit_id, person_id, href, said_at, indexed_at)
  values (org, k, id, '${CENTER}', left(t, 200), st, cl, prj, pty, unt, per, h, now(), now())
  on conflict (organization_id, kind, object_id) do update
    set title = excluded.title, state = excluded.state, closed = excluded.closed,
        project_id = excluded.project_id, party_id = excluded.party_id,
        unit_id = excluded.unit_id, person_id = excluded.person_id, href = excluded.href,
        said_at = now(), indexed_at = now()
$f$;

create function ${s}.kete_objects_of_project() returns trigger language plpgsql as $f$
begin
  perform ${s}.kete_objects_put(new.organization_id, 'project', new.project_id, new.name, new.status,
    new.status = 'closed', new.project_id, new.party_id, null, new.lead_user_id,
    '/projets/' || new.project_id);
  return new;
end $f$;
create trigger kete_objects_project after insert or update on ${s}.projects
  for each row execute function ${s}.kete_objects_of_project();

create function ${s}.kete_objects_of_party() returns trigger language plpgsql as $f$
begin
  perform ${s}.kete_objects_put(new.organization_id, 'party', new.party_id, new.name, new.status,
    new.status = 'merged', null, new.party_id, null, null, '/tiers/' || new.party_id);
  return new;
end $f$;
create trigger kete_objects_party after insert or update on ${s}.parties
  for each row execute function ${s}.kete_objects_of_party();

create function ${s}.kete_objects_of_unit() returns trigger language plpgsql as $f$
begin
  perform ${s}.kete_objects_put(new.organization_id, 'unit', new.unit_id, new.name,
    case when new.ends_on is not null and new.ends_on < current_date then 'closed' else 'active' end,
    new.ends_on is not null and new.ends_on < current_date, null, null, new.unit_id, null,
    '/administration/organisation?unite=' || new.unit_id);
  return new;
end $f$;
create trigger kete_objects_unit after insert or update on ${s}.units
  for each row execute function ${s}.kete_objects_of_unit();

create function ${s}.kete_objects_of_place() returns trigger language plpgsql as $f$
begin
  perform ${s}.kete_objects_put(new.organization_id, 'place', new.place_id, new.name, new.status,
    new.status = 'archived', null, new.party_id, new.unit_id, null, '/lieux/' || new.place_id);
  return new;
end $f$;
create trigger kete_objects_place after insert or update on ${s}.places
  for each row execute function ${s}.kete_objects_of_place();

create function ${s}.kete_objects_of_asset() returns trigger language plpgsql as $f$
begin
  perform ${s}.kete_objects_put(new.organization_id, 'asset', new.asset_id, new.name, new.state,
    new.state = 'retired', new.project_id, new.party_id, new.unit_id, new.holder_user_id,
    '/equipements/' || new.asset_id);
  delete from ${s}.object_links
   where organization_id = new.organization_id and from_kind = 'asset' and from_id = new.asset_id;
  if new.project_id is not null then
    insert into ${s}.object_links (organization_id, from_kind, from_id, relation, to_kind, to_id, product)
    values (new.organization_id, 'asset', new.asset_id, 'produced_by', 'project', new.project_id, '${CENTER}');
  end if;
  if new.place_id is not null then
    insert into ${s}.object_links (organization_id, from_kind, from_id, relation, to_kind, to_id, product)
    values (new.organization_id, 'asset', new.asset_id, 'located_at', 'place', new.place_id, '${CENTER}');
  end if;
  return new;
end $f$;
create trigger kete_objects_asset after insert or update on ${s}.assets
  for each row execute function ${s}.kete_objects_of_asset();

-- What existed before the index.
insert into ${s}.kete_objects (organization_id, kind, object_id, product, title, state, closed,
  project_id, party_id, person_id, href)
select organization_id, 'project', project_id, '${CENTER}', left(name, 200), status, status = 'closed',
       project_id, party_id, lead_user_id, '/projets/' || project_id
  from ${s}.projects
on conflict do nothing;
insert into ${s}.kete_objects (organization_id, kind, object_id, product, title, state, closed,
  party_id, href)
select organization_id, 'party', party_id, '${CENTER}', left(name, 200), status, status = 'merged',
       party_id, '/tiers/' || party_id
  from ${s}.parties
on conflict do nothing;
insert into ${s}.kete_objects (organization_id, kind, object_id, product, title, state, closed,
  unit_id, href)
select organization_id, 'unit', unit_id, '${CENTER}', left(name, 200),
       case when ends_on is not null and ends_on < current_date then 'closed' else 'active' end,
       ends_on is not null and ends_on < current_date, unit_id,
       '/administration/organisation?unite=' || unit_id
  from ${s}.units
on conflict do nothing;

-- A fact names the object it is about (kete-core spec 142): it inherits that object's axes.
alter table ${s}.money_facts add column object_kind text, add column object_id text;
alter table ${s}.time_facts add column object_kind text, add column object_id text;
`;
}

/** One object of the index, as a reader may read it. */
export interface IndexedObject {
  kind: string;
  id: string;
  product: string;
  title: string;
  state: string | null;
  stateLabel: string | null;
  stateTone: string | null;
  closed: boolean;
  projectId: string | null;
  partyId: string | null;
  unitId: string | null;
  personId: string | null;
  href: string | null;
  updatedAt: string;
}

type Row = {
  kind: string;
  object_id: string;
  product: string;
  title: string;
  state: string | null;
  closed: boolean;
  project_id: string | null;
  party_id: string | null;
  unit_id: string | null;
  person_id: string | null;
  href: string | null;
  said_at: Date;
};
const COLUMNS = `o.kind, o.object_id, o.product, o.title, o.state, o.closed, o.project_id,
  o.party_id, o.unit_id, o.person_id, o.href, o.said_at`;

function objectOf(row: Row, kinds: Kind[]): IndexedObject {
  const kind = kinds.find((k) => k.kind === row.kind);
  return {
    kind: row.kind,
    id: row.object_id,
    product: row.product,
    title: row.title,
    state: row.state,
    stateLabel: stateLabel(kind, row.state),
    stateTone: kind?.states.find((s) => s.id === row.state)?.tone ?? null,
    closed: row.closed,
    projectId: row.project_id,
    partyId: row.party_id,
    unitId: row.unit_id,
    personId: row.person_id,
    href: row.href ?? kind?.href?.replace('{id}', encodeURIComponent(row.object_id)) ?? null,
    updatedAt: row.said_at.toISOString(),
  };
}

/** What a reader may see of the index: the same rights as everywhere else (R4). */
export interface Sight {
  admin: boolean;
  userId: string;
  projects: string[];
  readsProjects: boolean;
  units: string[];
  everywhere: boolean;
  readsParties: boolean;
  /** Kinds whose titles travel only to their person, their project's team and the administrators. */
  confidential: string[];
}

const holds = async (db: SqlExecutor, identity: Identity, permission: string) => {
  const r = await reach(db, identity, permission);
  return r.everywhere || r.units.size > 0;
};

/**
 * Her sight of the index: an object is hers to see when she answers for it, belongs to its
 * project's team (or reads every project), works in its unit or holds `objects:read` over it, reads
 * the third parties it concerns, or when it has no axis at all — the organization's own.
 */
export async function sightOf(db: SqlExecutor, identity: Identity, kinds: Kind[]): Promise<Sight> {
  const admin = isAdministrator(identity);
  // One after the other: a transaction's connection takes one query at a time.
  const projects = await projectIdsOf(db, identity.userId);
  const readsProjects = admin ? true : await holds(db, identity, 'projects:read');
  const own = await unitsOfPerson(db, identity);
  const objectsReach = await reach(db, identity, 'objects:read');
  const readsParties = admin ? true : await holds(db, identity, 'parties:read');
  return {
    admin,
    userId: identity.userId,
    projects: [...projects],
    readsProjects,
    units: [...new Set([...own, ...objectsReach.units])],
    everywhere: admin || objectsReach.everywhere,
    readsParties,
    confidential: kinds.filter((k) => k.classification === 'confidential').map((k) => k.kind),
  };
}

/** The SQL that keeps a row of `o` (kete_objects) within her sight, from parameter `$first` on. */
export function sightSql(sight: Sight, first: number): { sql: string; params: unknown[] } {
  if (sight.admin) return { sql: 'true', params: [] };
  const p = (n: number) => `$${first + n}`;
  return {
    sql: `(o.person_id = ${p(0)}
      or o.project_id = any(${p(1)}::text[])
      or (o.kind = 'project' and o.object_id = any(${p(1)}::text[]))
      or (not (o.kind = any(${p(6)}::text[])) and (
           (${p(2)} and o.project_id is not null)
        or (o.unit_id is not null and (${p(4)} or o.unit_id = any(${p(3)}::text[])))
        or (${p(5)} and o.party_id is not null)
        or (o.project_id is null and o.unit_id is null and o.party_id is null and o.person_id is null))))`,
    params: [
      sight.userId,
      sight.projects,
      sight.readsProjects,
      sight.units,
      sight.everywhere,
      sight.readsParties,
      sight.confidential,
    ],
  };
}

export interface ObjectQuery {
  q?: string | undefined;
  kind?: string | undefined;
  projectId?: string | undefined;
  partyId?: string | undefined;
  unitId?: string | undefined;
  personId?: string | undefined;
  state?: string | undefined;
  closed?: boolean | undefined;
  limit?: number | undefined;
}

/** What she may read of the index, by words, kind, axis or state; the living ones first. */
export async function findObjects(
  db: SqlExecutor,
  identity: Identity,
  query: ObjectQuery,
): Promise<IndexedObject[]> {
  const kinds = await kindsOf(db);
  const sight = await sightOf(db, identity, kinds);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (query.q?.trim()) {
    add(`o.title ilike ?`, `%${query.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  }
  if (query.kind) add('o.kind = ?', query.kind);
  if (query.projectId) add('o.project_id = ?', query.projectId);
  if (query.partyId) add('o.party_id = ?', query.partyId);
  if (query.unitId) add('o.unit_id = ?', query.unitId);
  if (query.personId) add('o.person_id = ?', query.personId);
  if (query.state) add('o.state = ?', query.state);
  if (!query.closed) where.push('not o.closed');
  const sight$ = sightSql(sight, params.length + 1);
  params.push(...sight$.params);
  where.push(sight$.sql);
  params.push(Math.min(Math.max(query.limit ?? 50, 1), 200));
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from kete_objects o
      where ${where.join(' and ')}
      order by o.closed, o.said_at desc
      limit $${params.length}`,
    params,
  );
  return rows.map((row) => objectOf(row, kinds));
}

export interface ObjectCard {
  object: IndexedObject;
  /** Its named links, both ways, each with its words from the kind that declares it. */
  links: { relation: string; label: string; direction: 'out' | 'in'; object: IndexedObject }[];
  threadId: string | null;
  /** What is in progress about it: open holdings. */
  holdings: { id: string; what: string; holder: string; state: string; due: string | null }[];
}

/** One object she may read, with its named links she may read too, its thread and its holdings. */
export async function objectCard(
  db: SqlExecutor,
  identity: Identity,
  kind: string,
  id: string,
): Promise<ObjectCard | null> {
  const kinds = await kindsOf(db);
  const sight = await sightOf(db, identity, kinds);
  const one = sightSql(sight, 3);
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from kete_objects o where o.kind = $1 and o.object_id = $2 and ${one.sql}`,
    [kind, id, ...one.params],
  );
  const row = rows[0];
  if (!row) return null;
  const linked = sightSql(sight, 3);
  const { rows: links } = await db.query<Row & { relation: string; direction: 'out' | 'in' }>(
    `select ${COLUMNS}, l.relation, 'out' as direction
       from object_links l join kete_objects o on o.kind = l.to_kind and o.object_id = l.to_id
      where l.from_kind = $1 and l.from_id = $2 and ${linked.sql}
     union all
     select ${COLUMNS}, l.relation, 'in' as direction
       from object_links l join kete_objects o on o.kind = l.from_kind and o.object_id = l.from_id
      where l.to_kind = $1 and l.to_id = $2 and ${linked.sql}
      order by direction desc, relation
      limit 100`,
    [kind, id, ...linked.params],
  );
  const words = (from: string, relation: string, direction: 'out' | 'in') => {
    const declared = kinds
      .find((k) => k.kind === from)
      ?.links?.find((x) => x.relation === relation);
    if (!declared) return relation.replace(/_/g, ' ');
    return direction === 'out'
      ? (declared.label?.fr ?? relation)
      : (declared.inverse?.fr ?? relation);
  };
  const { rows: thread } = await db.query<{ thread_id: string }>(
    `select thread_id from kete_threads where kind = 'object' and object_kind = $1 and object_id = $2
      limit 1`,
    [kind, id],
  );
  const { rows: holdings } = await db.query<{
    holding_id: string;
    what: string;
    holder_id: string;
    state: string;
    due: string | null;
  }>(
    `select holding_id, what, holder_id, state, to_char(due, 'YYYY-MM-DD') as due from kete_holdings
      where object_kind = $1 and object_id = $2 and state <> 'done'
      order by due nulls last limit 20`,
    [kind, id],
  );
  return {
    object: objectOf(row, kinds),
    links: links.map((l) => ({
      relation: l.relation,
      label: words(l.direction === 'out' ? kind : l.kind, l.relation, l.direction),
      direction: l.direction,
      object: objectOf(l, kinds),
    })),
    threadId: thread[0]?.thread_id ?? null,
    holdings: holdings.map((h) => ({
      id: h.holding_id,
      what: h.what,
      holder: h.holder_id,
      state: h.state,
      due: h.due,
    })),
  };
}

/**
 * The titles of what objects she may read belong to — their client, project, unit, place. An
 * object she may read names what it belongs to; it never opens it: the third party's record, the
 * project's page keep their own rights (R4). Call it only for the axes of objects she may read.
 */
export async function titlesOf(
  db: SqlExecutor,
  refs: { kind: string; id: string | null }[],
): Promise<Record<string, string>> {
  const wanted = refs.filter((r): r is { kind: string; id: string } => Boolean(r.id));
  if (wanted.length === 0) return {};
  const { rows } = await db.query<{ kind: string; object_id: string; title: string }>(
    `select o.kind, o.object_id, o.title from kete_objects o
      where (o.kind, o.object_id) in (select * from unnest($1::text[], $2::text[]))`,
    [wanted.map((r) => r.kind), wanted.map((r) => r.id)],
  );
  return Object.fromEntries(rows.map((r) => [`${r.kind}:${r.object_id}`, r.title]));
}

/** The axes of these objects, as `titlesOf` reads them. */
export function axesOf(objects: IndexedObject[]): { kind: string; id: string | null }[] {
  return objects.flatMap((o) => [
    { kind: 'party', id: o.partyId },
    { kind: 'project', id: o.projectId },
    { kind: 'unit', id: o.unitId },
  ]);
}

/** A person's name, as the structure knows her. */
export async function nameOfPerson(db: SqlExecutor, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await db.query<{ name: string }>(
    `select name from people where account_user_id = $1 limit 1`,
    [userId],
  );
  return rows[0]?.name ?? null;
}

export class ObjectsError extends Error {
  constructor(
    readonly code: 'unknown_app' | 'invalid' | 'unknown_kind' | 'too_many',
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ObjectsError';
  }
}

/** The most objects an app says at once. */
export const OBJECTS_LIMIT = 500;

/**
 * Keeps the index in step with what an app says of its objects: only kinds its own manifest
 * declares, only links its kinds declare, an older saying never replacing a newer one, `gone`
 * taking an object out with the links it said.
 */
export async function receiveAppObjects(
  db: SqlExecutor,
  organizationId: string,
  clientId: string,
  input: { product: string; objects: unknown[] },
  now = new Date(),
): Promise<{ said: number; gone: number; stale: number }> {
  const app = (await listResources(db)).find(
    (r) =>
      r.kind === 'app' &&
      r.status === 'active' &&
      r.card?.product === input.product &&
      r.card.client === clientId,
  );
  if (!app)
    throw new ObjectsError('unknown_app', 'No active app of this product under this client.');
  if (input.objects.length > OBJECTS_LIMIT) {
    throw new ObjectsError('too_many', `At most ${OBJECTS_LIMIT} objects at once.`);
  }
  const kinds = (await kindsOf(db)).filter((k) => k.product === input.product);
  if (kinds.length === 0) {
    throw new ObjectsError('unknown_kind', 'This app declares no kind of object in its manifest.');
  }
  const issues: string[] = [];
  const said: KeteObject[] = [];
  input.objects.forEach((value, index) => {
    const checked = validateObject(value);
    if (!checked.ok) {
      issues.push(...checked.errors.map((e) => `#${index}: ${e}`));
      return;
    }
    const object = value as KeteObject;
    const kind = kinds.find((k) => k.kind === object.kind);
    if (!kind) issues.push(`#${index}: ${object.kind} is not a kind of ${input.product}.`);
    else if (object.state && !kind.states.some((s) => s.id === object.state)) {
      issues.push(`#${index}: ${object.state} is not a state of ${object.kind}.`);
    } else {
      for (const link of object.links ?? []) {
        if (!kind.links?.some((l) => l.relation === link.relation && l.to === link.kind)) {
          issues.push(
            `#${index}: ${object.kind} declares no link ${link.relation} to ${link.kind}.`,
          );
        }
      }
      said.push(object);
    }
  });
  if (issues.length > 0) {
    throw new ObjectsError('invalid', 'Some objects do not fit their kind.', issues.slice(0, 20));
  }
  let gone = 0;
  let stale = 0;
  for (const object of said) {
    if (object.gone) {
      const { rows: deleted } = await db.query(
        `delete from kete_objects where kind = $1 and object_id = $2 and product = $3
         returning object_id`,
        [object.kind, object.id, input.product],
      );
      await db.query(
        `delete from object_links where from_kind = $1 and from_id = $2 and product = $3`,
        [object.kind, object.id, input.product],
      );
      gone += deleted.length;
      continue;
    }
    const kind = kinds.find((k) => k.kind === object.kind);
    const at = object.updated_at ? new Date(object.updated_at) : now;
    const { rows: kept } = await db.query(
      `insert into kete_objects (organization_id, kind, object_id, product, title, state, closed,
         project_id, party_id, unit_id, person_id, href, said_at, indexed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
       on conflict (organization_id, kind, object_id) do update
         set title = excluded.title, state = excluded.state, closed = excluded.closed,
             project_id = excluded.project_id, party_id = excluded.party_id,
             unit_id = excluded.unit_id, person_id = excluded.person_id, href = excluded.href,
             said_at = excluded.said_at, indexed_at = now()
         where kete_objects.product = excluded.product and kete_objects.said_at <= excluded.said_at
       returning object_id`,
      [
        organizationId,
        object.kind,
        object.id,
        input.product,
        object.title,
        object.state ?? null,
        isClosed(kind, object.state),
        object.project_id ?? null,
        object.party_id ?? null,
        object.unit_id ?? null,
        object.person_id ?? null,
        object.href ?? null,
        at,
      ],
    );
    if (kept.length === 0) {
      stale += 1;
      continue;
    }
    await db.query(
      `delete from object_links where from_kind = $1 and from_id = $2 and product = $3`,
      [object.kind, object.id, input.product],
    );
    for (const link of object.links ?? []) {
      await db.query(
        `insert into object_links (organization_id, from_kind, from_id, relation, to_kind, to_id, product)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
        [organizationId, object.kind, object.id, link.relation, link.kind, link.id, input.product],
      );
    }
  }
  return { said: said.length - gone - stale, gone, stale };
}

export { CENTER };
