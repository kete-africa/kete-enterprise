import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// Dossiers (spec 034): one space per subject — the ISO audit, the monthly SAV review — shared by
// its members, with its documents (a library source open to them only), and what it gathers from
// the rest of Kete Enterprise by reference: conversations, actions, decisions, apps, links.

export function dossiersMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.dossiers (
  organization_id text not null,
  dossier_id text not null,
  name text not null check (length(name) between 1 and 160),
  description text check (length(description) <= 1000),
  source_id text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  primary key (organization_id, dossier_id)
);
${policy('dossiers')}
grant select, insert, update on ${s}.dossiers to ${options.appRole};

create table ${s}.dossier_members (
  organization_id text not null,
  dossier_id text not null,
  user_id text not null,
  name text not null check (length(name) between 1 and 200),
  role text not null check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (organization_id, dossier_id, user_id),
  foreign key (organization_id, dossier_id) references ${s}.dossiers (organization_id, dossier_id) on delete cascade
);
create index dossier_members_user on ${s}.dossier_members (organization_id, user_id);
${policy('dossier_members')}
grant select, insert, update, delete on ${s}.dossier_members to ${options.appRole};

create table ${s}.dossier_links (
  organization_id text not null,
  dossier_id text not null,
  link_id text not null,
  kind text not null check (kind in ('conversation', 'action', 'decision', 'app', 'url')),
  ref text not null check (length(ref) between 1 and 300),
  title text not null check (length(title) between 1 and 300),
  href text not null check (href ~ '^(/|https://)'),
  added_by text not null,
  added_at timestamptz not null default now(),
  primary key (organization_id, link_id),
  unique (organization_id, dossier_id, kind, ref),
  foreign key (organization_id, dossier_id) references ${s}.dossiers (organization_id, dossier_id) on delete cascade
);
${policy('dossier_links')}
grant select, insert, delete on ${s}.dossier_links to ${options.appRole};
`;
}

export const dossierInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
});

export const linkInput = z.object({
  kind: z.enum(['conversation', 'action', 'decision', 'app', 'url']),
  ref: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  href: z
    .string()
    .regex(/^(\/|https:\/\/)/)
    .max(1000),
});

export interface Member {
  userId: string;
  name: string;
  role: 'owner' | 'member';
}

export interface DossierLink {
  linkId: string;
  kind: z.infer<typeof linkInput>['kind'];
  ref: string;
  title: string;
  href: string;
  addedBy: string;
  addedAt: string;
}

export interface Dossier {
  dossierId: string;
  name: string;
  description: string | null;
  sourceId: string;
  createdAt: string;
  archived: boolean;
  /** Her role in it; null when she is not a member. */
  role: 'owner' | 'member' | null;
  members: number;
}

type DossierRow = {
  dossier_id: string;
  name: string;
  description: string | null;
  source_id: string;
  created_at: Date;
  archived_at: Date | null;
  role: 'owner' | 'member' | null;
  members: number;
};
const dossierOf = (r: DossierRow): Dossier => ({
  dossierId: r.dossier_id,
  name: r.name,
  description: r.description,
  sourceId: r.source_id,
  createdAt: r.created_at.toISOString(),
  archived: r.archived_at !== null,
  role: r.role,
  members: r.members,
});
const COLUMNS = (userParam: string) => `d.dossier_id, d.name, d.description, d.source_id,
  d.created_at, d.archived_at,
  (select m.role from dossier_members m where m.dossier_id = d.dossier_id and m.user_id = ${userParam}) as role,
  (select count(*)::int from dossier_members m where m.dossier_id = d.dossier_id) as members`;

/** The dossiers she is a member of, the open ones first. */
export async function dossiersOf(db: SqlExecutor, userId: string): Promise<Dossier[]> {
  const { rows } = await db.query<DossierRow>(
    `select ${COLUMNS('$1')} from dossiers d
      where exists (select 1 from dossier_members m where m.dossier_id = d.dossier_id and m.user_id = $1)
      order by d.archived_at nulls first, d.created_at desc`,
    [userId],
  );
  return rows.map(dossierOf);
}

export async function getDossier(
  db: SqlExecutor,
  dossierId: string,
  userId: string,
): Promise<Dossier | null> {
  const { rows } = await db.query<DossierRow>(
    `select ${COLUMNS('$2')} from dossiers d where d.dossier_id = $1`,
    [dossierId, userId],
  );
  return rows[0] ? dossierOf(rows[0]) : null;
}

/** A new dossier's id, to open its library source to its members before it exists. */
export const newDossierId = () => newId('dos');

export async function insertDossier(
  db: SqlExecutor,
  input: {
    organizationId: string;
    dossierId: string;
    sourceId: string;
    owner: { userId: string; name: string };
    name: string;
    description?: string | undefined;
  },
): Promise<string> {
  const { dossierId } = input;
  await db.query(
    `insert into dossiers (organization_id, dossier_id, name, description, source_id, created_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.organizationId,
      dossierId,
      input.name,
      input.description ?? null,
      input.sourceId,
      input.owner.userId,
    ],
  );
  await addMember(db, input.organizationId, dossierId, { ...input.owner, role: 'owner' });
  return dossierId;
}

export async function membersOf(db: SqlExecutor, dossierId: string): Promise<Member[]> {
  const { rows } = await db.query<{ user_id: string; name: string; role: Member['role'] }>(
    `select user_id, name, role from dossier_members where dossier_id = $1 order by role desc, name`,
    [dossierId],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name, role: r.role }));
}

export async function addMember(
  db: SqlExecutor,
  organizationId: string,
  dossierId: string,
  member: Member,
): Promise<void> {
  await db.query(
    `insert into dossier_members (organization_id, dossier_id, user_id, name, role)
     values ($1, $2, $3, $4, $5)
     on conflict (organization_id, dossier_id, user_id) do update set role = $5, name = $4`,
    [organizationId, dossierId, member.userId, member.name, member.role],
  );
}

export async function removeMember(
  db: SqlExecutor,
  dossierId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ user_id: string }>(
    `delete from dossier_members where dossier_id = $1 and user_id = $2 and role <> 'owner'
     returning user_id`,
    [dossierId, userId],
  );
  return rows.length > 0;
}

export async function linksOf(db: SqlExecutor, dossierId: string): Promise<DossierLink[]> {
  const { rows } = await db.query<{
    link_id: string;
    kind: DossierLink['kind'];
    ref: string;
    title: string;
    href: string;
    added_by: string;
    added_at: Date;
  }>(
    `select link_id, kind, ref, title, href, added_by, added_at from dossier_links
      where dossier_id = $1 order by added_at desc`,
    [dossierId],
  );
  return rows.map((r) => ({
    linkId: r.link_id,
    kind: r.kind,
    ref: r.ref,
    title: r.title,
    href: r.href,
    addedBy: r.added_by,
    addedAt: r.added_at.toISOString(),
  }));
}

export async function addLink(
  db: SqlExecutor,
  organizationId: string,
  dossierId: string,
  userId: string,
  link: z.infer<typeof linkInput>,
): Promise<string> {
  const linkId = newId('dln');
  const { rows } = await db.query<{ link_id: string }>(
    `insert into dossier_links (organization_id, dossier_id, link_id, kind, ref, title, href, added_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (organization_id, dossier_id, kind, ref) do update set title = $6
     returning link_id`,
    [organizationId, dossierId, linkId, link.kind, link.ref, link.title, link.href, userId],
  );
  return rows[0]?.link_id ?? linkId;
}

export async function removeLink(
  db: SqlExecutor,
  dossierId: string,
  linkId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ link_id: string }>(
    `delete from dossier_links where dossier_id = $1 and link_id = $2 returning link_id`,
    [dossierId, linkId],
  );
  return rows.length > 0;
}

export async function setArchived(
  db: SqlExecutor,
  dossierId: string,
  archived: boolean,
): Promise<void> {
  await db.query(
    `update dossiers set archived_at = ${archived ? 'now()' : 'null'} where dossier_id = $1`,
    [dossierId],
  );
}

/** The audiences her dossiers open: `dossier:<id>` for each one she is a member of. */
export async function dossierKeys(db: SqlExecutor, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ dossier_id: string }>(
    `select dossier_id from dossier_members where user_id = $1`,
    [userId],
  );
  return rows.map((r) => `dossier:${r.dossier_id}`);
}
