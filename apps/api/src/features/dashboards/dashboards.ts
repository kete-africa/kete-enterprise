import { randomUUID } from 'node:crypto';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { querySpec } from '../datasets/index.js';

// Dashboards (spec 033): cards over the organization's data — a team's tables, a form's answers —
// each a small query and a way to show it; composed by a person or proposed by her assistant, kept
// by her, opened to others by an administrator, always read with the reader's own rights.

export function dashboardsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.dashboards (
  organization_id text not null,
  dashboard_id text not null,
  name text not null check (length(name) between 1 and 160),
  description text check (length(description) <= 1000),
  widgets jsonb not null,
  audience text[] not null check (cardinality(audience) between 1 and 200),
  owner_id text not null,
  status text not null check (status in ('proposed', 'kept')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, dashboard_id)
);
${organizationPolicySql({ schema: s, table: 'dashboards', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.dashboards to ${options.appRole};
`;
}

/** The dashboards a person pinned on her « Aujourd'hui » (spec 046): hers alone, in order. */
export function dashboardPinsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.dashboard_pins (
  organization_id text not null,
  user_id text not null,
  dashboard_id text not null,
  pinned_at timestamptz not null default now(),
  primary key (organization_id, user_id, dashboard_id),
  foreign key (organization_id, dashboard_id)
    references ${s}.dashboards (organization_id, dashboard_id) on delete cascade
);
${organizationPolicySql({ schema: s, table: 'dashboard_pins', appRole: options.appRole })}
grant select, insert, delete on ${s}.dashboard_pins to ${options.appRole};
`;
}

/**
 * Every change its owner makes keeps the state before it (spec 050), and a dashboard may be a
 * reader's own version of another.
 */
export function dashboardVersionsMigrationSql(options: {
  schema: string;
  appRole: string;
}): string {
  const s = options.schema;
  return `
alter table ${s}.dashboards add column forked_from text;
create table ${s}.dashboard_versions (
  organization_id text not null,
  dashboard_id text not null,
  version integer not null,
  name text not null,
  widgets jsonb not null,
  saved_by text not null,
  saved_at timestamptz not null default now(),
  primary key (organization_id, dashboard_id, version),
  foreign key (organization_id, dashboard_id)
    references ${s}.dashboards (organization_id, dashboard_id) on delete cascade
);
${organizationPolicySql({ schema: s, table: 'dashboard_versions', appRole: options.appRole })}
grant select, insert, delete on ${s}.dashboard_versions to ${options.appRole};
`;
}

/** Where a card sits on its dashboard's grid of 12 columns (spec 050). */
const place = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});
/** What a figure aims at, and whether more is better. */
const goal = z.object({ value: z.number().finite(), better: z.enum(['up', 'down']) });
const common = {
  /** Stable, for its place on the grid and the assistant's changes. */
  id: z
    .string()
    .regex(/^w[0-9a-z]{1,24}$/)
    .optional(),
  title: z.string().trim().min(1).max(160),
  place: place.optional(),
  /** Proposed by the assistant: kept or removed by the owner. */
  proposed: z.boolean().optional(),
};

/** A card of figures: where its rows come from, the query that sums them up, how it is shown. */
export const dataWidget = z.object({
  ...common,
  kind: z.literal('data').optional(),
  source: z.object({
    kind: z.enum(['dataset', 'form']),
    id: z.string().min(1).max(80),
  }),
  query: querySpec,
  view: z.enum(['number', 'bar', 'line', 'pie', 'table']),
  goal: goal.optional(),
  /** Over it, the figure says so. */
  threshold: z.number().finite().optional(),
});
/** A note: a title and a text of its owner's, for whoever reads the dashboard. */
export const noteWidget = z.object({
  ...common,
  kind: z.literal('note'),
  text: z.string().trim().max(4000),
});
export const widget = z.union([noteWidget, dataWidget]);
export type Widget = z.infer<typeof widget>;
export type DataWidget = z.infer<typeof dataWidget>;
export type NoteWidget = z.infer<typeof noteWidget>;
export const isNote = (w: Widget): w is NoteWidget => w.kind === 'note';

/** Each card its id: kept when it has one, a fresh one otherwise. */
export function withIds(widgets: Widget[]): Widget[] {
  const used = new Set(widgets.flatMap((w) => (w.id ? [w.id] : [])));
  return widgets.map((w) => {
    if (w.id) return w;
    let id = '';
    do id = `w${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    while (used.has(id));
    used.add(id);
    return { ...w, id };
  });
}

export const dashboardInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  widgets: z.array(widget).max(24),
});

export interface Dashboard {
  dashboardId: string;
  name: string;
  description: string | null;
  widgets: Widget[];
  audience: string[];
  ownerId: string;
  status: 'proposed' | 'kept';
  /** The dashboard this one is a reader's version of. */
  forkedFrom: string | null;
  updatedAt: string;
}

type Row = {
  dashboard_id: string;
  name: string;
  description: string | null;
  widgets: Widget[];
  audience: string[];
  owner_id: string;
  status: 'proposed' | 'kept';
  forked_from: string | null;
  updated_at: Date;
};
const dashboardOf = (r: Row): Dashboard => ({
  dashboardId: r.dashboard_id,
  name: r.name,
  description: r.description,
  // Cards stored before spec 050 have no id: one by their rank, until their owner saves them.
  widgets: r.widgets.map((w, i) => (w.id ? w : { ...w, id: `wi${i}` })),
  audience: r.audience,
  ownerId: r.owner_id,
  status: r.status,
  forkedFrom: r.forked_from,
  updatedAt: r.updated_at.toISOString(),
});
const COLUMNS =
  'dashboard_id, name, description, widgets, audience, owner_id, status, forked_from, updated_at';

export async function createDashboard(
  db: SqlExecutor,
  input: z.infer<typeof dashboardInput> & {
    organizationId: string;
    ownerId: string;
    status: 'proposed' | 'kept';
    forkedFrom?: string;
  },
): Promise<Dashboard> {
  const { rows } = await db.query<Row>(
    `insert into dashboards (organization_id, dashboard_id, name, description, widgets, audience,
       owner_id, status, forked_from)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLUMNS}`,
    [
      input.organizationId,
      newId('dsh'),
      input.name,
      input.description ?? null,
      JSON.stringify(withIds(input.widgets)),
      [`user:${input.ownerId}`],
      input.ownerId,
      input.status,
      input.forkedFrom ?? null,
    ],
  );
  return dashboardOf(rows[0] as Row);
}

export async function getDashboard(
  db: SqlExecutor,
  dashboardId: string,
): Promise<Dashboard | null> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from dashboards where dashboard_id = $1`,
    [dashboardId],
  );
  return rows[0] ? dashboardOf(rows[0]) : null;
}

/** The dashboards a reader's keys open, hers first; all of them for an administrator. */
export async function listDashboards(
  db: SqlExecutor,
  readerKeys: string[] | null,
): Promise<Dashboard[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from dashboards
      where $1::text[] is null or audience && $1::text[] order by updated_at desc`,
    [readerKeys],
  );
  return rows.map(dashboardOf);
}

export async function updateDashboard(
  db: SqlExecutor,
  dashboardId: string,
  change: {
    name?: string;
    description?: string;
    widgets?: Widget[];
    audience?: string[];
    status?: 'kept';
  },
): Promise<Dashboard | null> {
  await db.query(
    `update dashboards set name = coalesce($2, name), description = coalesce($3, description),
       widgets = coalesce($4, widgets), audience = coalesce($5, audience),
       status = coalesce($6, status), updated_at = now()
     where dashboard_id = $1`,
    [
      dashboardId,
      change.name ?? null,
      change.description ?? null,
      change.widgets ? JSON.stringify(withIds(change.widgets)) : null,
      change.audience ?? null,
      change.status ?? null,
    ],
  );
  return getDashboard(db, dashboardId);
}

export async function removeDashboard(db: SqlExecutor, dashboardId: string): Promise<boolean> {
  const { rows } = await db.query(
    `delete from dashboards where dashboard_id = $1 returning dashboard_id`,
    [dashboardId],
  );
  return rows.length > 0;
}

/** Pins a dashboard on her « Aujourd'hui », or unpins it. */
export async function pinDashboard(
  db: SqlExecutor,
  input: { organizationId: string; userId: string; dashboardId: string; pinned: boolean },
): Promise<void> {
  if (input.pinned) {
    await db.query(
      `insert into dashboard_pins (organization_id, user_id, dashboard_id) values ($1, $2, $3)
        on conflict do nothing`,
      [input.organizationId, input.userId, input.dashboardId],
    );
  } else {
    await db.query(`delete from dashboard_pins where user_id = $1 and dashboard_id = $2`, [
      input.userId,
      input.dashboardId,
    ]);
  }
}

/** The dashboards she pinned, oldest pin first. */
export async function pinnedIdsOf(db: SqlExecutor, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ dashboard_id: string }>(
    `select dashboard_id from dashboard_pins where user_id = $1 order by pinned_at`,
    [userId],
  );
  return rows.map((r) => r.dashboard_id);
}

export interface DashboardVersion {
  version: number;
  name: string;
  cardCount: number;
  savedBy: string;
  savedAt: string;
}

/** Keeps the dashboard as it is now, before a change (spec 050). */
export async function saveVersion(
  db: SqlExecutor,
  input: { organizationId: string; dashboard: Dashboard; savedBy: string },
): Promise<void> {
  await db.query(
    `insert into dashboard_versions (organization_id, dashboard_id, version, name, widgets, saved_by)
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5
       from dashboard_versions where dashboard_id = $2`,
    [
      input.organizationId,
      input.dashboard.dashboardId,
      input.dashboard.name,
      JSON.stringify(input.dashboard.widgets),
      input.savedBy,
    ],
  );
}

/** Its kept versions, the latest first. */
export async function versionsOf(
  db: SqlExecutor,
  dashboardId: string,
): Promise<DashboardVersion[]> {
  const { rows } = await db.query<{
    version: number;
    name: string;
    card_count: number;
    saved_by: string;
    saved_at: Date;
  }>(
    `select version, name, jsonb_array_length(widgets) as card_count, saved_by, saved_at
       from dashboard_versions where dashboard_id = $1 order by version desc limit 50`,
    [dashboardId],
  );
  return rows.map((r) => ({
    version: r.version,
    name: r.name,
    cardCount: Number(r.card_count),
    savedBy: r.saved_by,
    savedAt: r.saved_at.toISOString(),
  }));
}

export async function versionOf(
  db: SqlExecutor,
  dashboardId: string,
  version: number,
): Promise<{ name: string; widgets: Widget[] } | null> {
  const { rows } = await db.query<{ name: string; widgets: Widget[] }>(
    `select name, widgets from dashboard_versions where dashboard_id = $1 and version = $2`,
    [dashboardId, version],
  );
  return rows[0] ?? null;
}
