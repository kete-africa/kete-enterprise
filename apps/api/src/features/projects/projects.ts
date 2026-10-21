import { defineCommand } from '@kete/commands';
import { createSource } from '@kete/knowledge';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { openThread } from '@kete/threads';
import { z } from 'zod';
import {
  addMember,
  insertDossier,
  membersOf,
  newDossierId,
  removeMember,
} from '../dossiers/index.js';
import { findParty } from '../parties/index.js';

// Projects (spec 074, doctrine D-047): one object. Where a job is discussed — its thread, its
// files, its instructions: its dossier — is where its team, its client, its phases and its budget
// are seen. A project is born from a sentence, or from an app (a won quote), whose lines become
// the posts of its budget. It is a reference of the center: apps cite it by its identifier, and
// every fact of money carries it. Belonging to a project is a second axis of rights, beside the
// structure. Without a project, a fact goes to « Fonctionnement ».

export function projectsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.projects (
  organization_id text not null,
  project_id text not null,
  name text not null check (length(name) between 1 and 160),
  -- Its thread, its files, its team: one dossier, born with it.
  dossier_id text not null,
  -- For whom, or by whom it is funded: a third party of the center.
  party_id text,
  lead_user_id text not null,
  status text not null default 'open' check (status in ('open', 'delivered', 'closed')),
  phase text check (length(phase) <= 80),
  starts_on date,
  ends_on date,
  -- What it was sold for, in the currency's smallest unit; its budget is in its posts.
  sold_amount bigint check (sold_amount >= 0),
  currency text not null default 'XOF' check (currency ~ '^[A-Z]{3}$'),
  -- The app's document it was born from — a won quote — once only.
  born_source text check (length(born_source) <= 80),
  born_ref text check (length(born_ref) <= 200),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, project_id),
  unique (organization_id, dossier_id),
  unique (organization_id, born_source, born_ref),
  check ((born_source is null) = (born_ref is null)),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  foreign key (organization_id, dossier_id) references ${s}.dossiers (organization_id, dossier_id),
  foreign key (organization_id, party_id) references ${s}.parties (organization_id, party_id)
);
${policy('projects')}
grant select, insert, update on ${s}.projects to ${options.appRole};

-- The posts of its budget: what may be spent, and on what.
create table ${s}.project_posts (
  organization_id text not null,
  project_id text not null,
  post_id text not null,
  name text not null check (length(name) between 1 and 120),
  budget_amount bigint not null check (budget_amount >= 0),
  position integer not null default 0,
  primary key (organization_id, post_id),
  unique (organization_id, project_id, name),
  foreign key (organization_id, project_id)
    references ${s}.projects (organization_id, project_id) on delete cascade
);
${policy('project_posts')}
grant select, insert, update, delete on ${s}.project_posts to ${options.appRole};
`;
}

export type ProjectStatus = 'open' | 'delivered' | 'closed';

export interface ProjectPost {
  postId: string;
  name: string;
  /** In the currency's smallest unit (`@kete/money`). */
  budget: number;
}

export interface Project {
  projectId: string;
  name: string;
  dossierId: string;
  party: { partyId: string; name: string } | null;
  lead: { userId: string; name: string };
  status: ProjectStatus;
  phase: string | null;
  startsOn: string | null;
  endsOn: string | null;
  sold: number | null;
  currency: string;
  bornFrom: { source: string; ref: string } | null;
  team: { userId: string; name: string; lead: boolean }[];
  posts: ProjectPost[];
  /** The sum of its posts: what it may cost. */
  budget: number;
  /** What it was sold for less what it may cost; none while it was sold for nothing. */
  expectedMargin: number | null;
}

type Row = {
  project_id: string;
  name: string;
  dossier_id: string;
  party_id: string | null;
  lead_user_id: string;
  status: ProjectStatus;
  phase: string | null;
  starts_on: string | null;
  ends_on: string | null;
  sold_amount: string | null;
  currency: string;
  born_source: string | null;
  born_ref: string | null;
};
// Days as text: a date read as a moment shifts with the server's time zone.
const COLUMNS = `project_id, name, dossier_id, party_id, lead_user_id, status, phase,
  starts_on::text, ends_on::text, sold_amount, currency, born_source, born_ref`;

async function projectOf(db: SqlExecutor, row: Row): Promise<Project> {
  const members = await membersOf(db, row.dossier_id);
  const { rows: posts } = await db.query<{ post_id: string; name: string; budget_amount: string }>(
    `select post_id, name, budget_amount from project_posts where project_id = $1
      order by position, name`,
    [row.project_id],
  );
  const party = row.party_id ? await findParty(db, row.party_id) : null;
  const budget = posts.reduce((total, post) => total + Number(post.budget_amount), 0);
  const sold = row.sold_amount === null ? null : Number(row.sold_amount);
  const lead = members.find((member) => member.userId === row.lead_user_id);
  return {
    projectId: row.project_id,
    name: row.name,
    dossierId: row.dossier_id,
    party: party ? { partyId: party.partyId, name: party.name } : null,
    lead: { userId: row.lead_user_id, name: lead?.name ?? row.lead_user_id },
    status: row.status,
    phase: row.phase,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    sold,
    currency: row.currency,
    bornFrom:
      row.born_source && row.born_ref ? { source: row.born_source, ref: row.born_ref } : null,
    team: members.map((member) => ({
      userId: member.userId,
      name: member.name,
      lead: member.userId === row.lead_user_id,
    })),
    posts: posts.map((post) => ({
      postId: post.post_id,
      name: post.name,
      budget: Number(post.budget_amount),
    })),
    budget,
    expectedMargin: sold === null ? null : sold - budget,
  };
}

/** The projects she belongs to — the second axis of rights; `all`: every project, for who reads them all. */
export async function projectsFor(
  db: SqlExecutor,
  userId: string,
  options: { all: boolean },
): Promise<Project[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from projects p
      where $2 or exists (select 1 from dossier_members m
                           where m.dossier_id = p.dossier_id and m.user_id = $1)
      order by case status when 'open' then 0 when 'delivered' then 1 else 2 end, created_at desc
      limit 200`,
    [userId, options.all],
  );
  return Promise.all(rows.map((row) => projectOf(db, row)));
}

export async function findProject(db: SqlExecutor, projectId: string): Promise<Project | null> {
  const { rows } = await db.query<Row>(`select ${COLUMNS} from projects where project_id = $1`, [
    projectId,
  ]);
  return rows[0] ? projectOf(db, rows[0]) : null;
}

/** The identifiers of the projects she belongs to: what the second axis of rights reads. */
export async function projectIdsOf(db: SqlExecutor, userId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ project_id: string }>(
    `select p.project_id from projects p join dossier_members m on m.dossier_id = p.dossier_id
      where m.user_id = $1`,
    [userId],
  );
  return new Set(rows.map((row) => row.project_id));
}

/** A rule of the projects was not met: the change is refused, nothing is written. */
export class ProjectError extends Error {
  constructor(
    readonly code: 'not_found' | 'unknown_party' | 'closed' | 'lead_stays',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const postInput = z.object({ name: z.string().trim().min(1).max(120), budget: amount });

export const createProjectInput = z.object({
  name: z.string().trim().min(1).max(160),
  partyId: z
    .string()
    .regex(/^pty_[0-9a-f-]{8,64}$/)
    .optional(),
  /** Who leads it: her name as the screens show it. Default: who creates it. */
  lead: z
    .object({ userId: z.string().min(1).max(128), name: z.string().min(1).max(200) })
    .optional(),
  phase: z.string().trim().max(80).optional(),
  startsOn: day.optional(),
  endsOn: day.optional(),
  sold: amount.optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('XOF'),
  posts: z.array(postInput).max(40).default([]),
  /** The app's document it is born from: asked twice, it is the same project. */
  bornFrom: z
    .object({ source: z.string().trim().min(1).max(80), ref: z.string().trim().min(1).max(200) })
    .optional(),
});

/**
 * A project is born — from a sentence (a name is enough) or from an app's document, whose lines
 * come as posts. Its dossier is born with it: its thread, its files, its team, who creates it
 * leading it unless a lead is named.
 */
export const createProject = defineCommand({
  name: 'create-project',
  input: createProjectInput.extend({
    /** Who creates it, as the request knows her: the dossier's first member. */
    creator: z.object({ userId: z.string().min(1), name: z.string().min(1) }),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    if (input.bornFrom) {
      const born = await db.query<Row>(
        `select ${COLUMNS} from projects where born_source = $1 and born_ref = $2`,
        [input.bornFrom.source, input.bornFrom.ref],
      );
      if (born.rows[0]) return { project: await projectOf(db, born.rows[0]), created: false };
    }
    if (input.partyId && !(await findParty(db, input.partyId))) {
      throw new ProjectError('unknown_party', 'No such third party here.');
    }
    const party = input.partyId ? await findParty(db, input.partyId) : null;
    const lead = input.lead ?? input.creator;
    const dossierId = newDossierId();
    const source = await createSource(db, organizationId, {
      name: input.name,
      kind: 'dossier',
      audience: [`dossier:${dossierId}`],
    });
    await insertDossier(db, {
      organizationId,
      dossierId,
      sourceId: source.sourceId,
      owner: lead,
      name: input.name,
    });
    if (input.creator.userId !== lead.userId) {
      await addMember(db, organizationId, dossierId, { ...input.creator, role: 'member' });
    }
    const projectId = newId('prj');
    await db.query(
      `insert into projects (organization_id, project_id, name, dossier_id, party_id, lead_user_id,
         phase, starts_on, ends_on, sold_amount, currency, born_source, born_ref, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        organizationId,
        projectId,
        input.name,
        dossierId,
        party?.partyId ?? null,
        lead.userId,
        input.phase ?? null,
        input.startsOn ?? null,
        input.endsOn ?? null,
        input.sold ?? null,
        input.currency,
        input.bornFrom?.source ?? null,
        input.bornFrom?.ref ?? null,
        input.creator.userId,
      ],
    );
    for (const [position, post] of input.posts.entries()) {
      await db.query(
        `insert into project_posts (organization_id, project_id, post_id, name, budget_amount, position)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (organization_id, project_id, name) do update
           set budget_amount = project_posts.budget_amount + excluded.budget_amount`,
        [organizationId, projectId, newId('pst'), post.name, post.budget, position],
      );
    }
    // Its thread is born with it (spec 098, FR-010): its lead holds it, its creator is a member.
    await openThread(db, organizationId, {
      kind: 'object',
      object: { kind: 'project', id: projectId },
      title: input.name,
      holder: { kind: 'person', id: lead.userId },
      members: [{ kind: 'person', id: input.creator.userId }],
    });
    return { project: (await findProject(db, projectId)) as Project, created: true };
  },
  summarize: (input) => `Project: ${input.name}`,
});

const projectId = z.string().regex(/^prj_[0-9a-f-]{8,64}$/);

async function open(db: SqlExecutor, id: string): Promise<Project> {
  const project = await findProject(db, id);
  if (!project) throw new ProjectError('not_found', 'No such project here.');
  if (project.status === 'closed') throw new ProjectError('closed', 'This project is closed.');
  return project;
}

/** A post of its budget is set: added, or its amount changed. */
export const setPost = defineCommand({
  name: 'set-project-post',
  input: postInput.extend({ projectId }),
  reversibility: { reversible: true, inverse: 'set-project-post' },
  async handler(input, { db, organizationId }) {
    const project = await open(db, input.projectId);
    const before = project.posts.find((post) => post.name === input.name)?.budget ?? null;
    await db.query(
      `insert into project_posts (organization_id, project_id, post_id, name, budget_amount, position)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (organization_id, project_id, name) do update set budget_amount = excluded.budget_amount`,
      [
        organizationId,
        project.projectId,
        newId('pst'),
        input.name,
        input.budget,
        project.posts.length,
      ],
    );
    return { project: (await findProject(db, project.projectId)) as Project, before };
  },
  summarize: (input) => `Budget post ${input.name}: ${input.budget}`,
});

/** Its phase, its dates, what it was sold for, and where it stands. */
export const updateProject = defineCommand({
  name: 'update-project',
  input: z.object({
    projectId,
    name: z.string().trim().min(1).max(160).optional(),
    phase: z.string().trim().max(80).nullable().optional(),
    startsOn: day.nullable().optional(),
    endsOn: day.nullable().optional(),
    sold: amount.nullable().optional(),
    status: z.enum(['open', 'delivered', 'closed']).optional(),
  }),
  reversibility: { reversible: true, inverse: 'update-project' },
  async handler(input, { db }) {
    const before = await findProject(db, input.projectId);
    if (!before) throw new ProjectError('not_found', 'No such project here.');
    // A closed project is read; it opens again before anything else changes.
    if (before.status === 'closed' && input.status === undefined) {
      throw new ProjectError('closed', 'This project is closed.');
    }
    const pick = <T>(next: T | undefined, current: T): T => (next === undefined ? current : next);
    await db.query(
      `update projects set name = $2, phase = $3, starts_on = $4, ends_on = $5, sold_amount = $6,
         status = $7, updated_at = now() where project_id = $1`,
      [
        before.projectId,
        pick(input.name, before.name),
        pick(input.phase, before.phase),
        pick(input.startsOn, before.startsOn),
        pick(input.endsOn, before.endsOn),
        pick(input.sold, before.sold),
        pick(input.status, before.status),
      ],
    );
    return {
      project: (await findProject(db, before.projectId)) as Project,
      before: { status: before.status, phase: before.phase },
    };
  },
  summarize: (_input, output) => `Project updated: ${output.project.name}`,
});

/** Someone joins its team, or leaves it. Its lead stays. */
export const setTeam = defineCommand({
  name: 'set-project-team',
  input: z.object({
    projectId,
    member: z.object({ userId: z.string().min(1).max(128), name: z.string().min(1).max(200) }),
    on: z.boolean(),
  }),
  reversibility: { reversible: true, inverse: 'set-project-team' },
  async handler(input, { db, organizationId }) {
    const project = await open(db, input.projectId);
    if (input.on) {
      await addMember(db, organizationId, project.dossierId, {
        ...input.member,
        role: input.member.userId === project.lead.userId ? 'owner' : 'member',
      });
    } else {
      if (input.member.userId === project.lead.userId) {
        throw new ProjectError('lead_stays', 'A project keeps its lead.');
      }
      await removeMember(db, project.dossierId, input.member.userId);
    }
    return { project: (await findProject(db, project.projectId)) as Project };
  },
  summarize: (input) =>
    `${input.member.name} ${input.on ? 'joins' : 'leaves'} project ${input.projectId}`,
});
