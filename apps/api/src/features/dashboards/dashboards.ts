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

/** A card: its title, where its rows come from, the query that sums them up, how it is shown. */
export const widget = z.object({
  title: z.string().trim().min(1).max(160),
  source: z.object({
    kind: z.enum(['dataset', 'form']),
    id: z.string().min(1).max(80),
  }),
  query: querySpec,
  view: z.enum(['number', 'bar', 'line', 'pie', 'table']),
});
export type Widget = z.infer<typeof widget>;

export const dashboardInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  widgets: z.array(widget).max(12),
});

export interface Dashboard {
  dashboardId: string;
  name: string;
  description: string | null;
  widgets: Widget[];
  audience: string[];
  ownerId: string;
  status: 'proposed' | 'kept';
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
  updated_at: Date;
};
const dashboardOf = (r: Row): Dashboard => ({
  dashboardId: r.dashboard_id,
  name: r.name,
  description: r.description,
  widgets: r.widgets,
  audience: r.audience,
  ownerId: r.owner_id,
  status: r.status,
  updatedAt: r.updated_at.toISOString(),
});
const COLUMNS = 'dashboard_id, name, description, widgets, audience, owner_id, status, updated_at';

export async function createDashboard(
  db: SqlExecutor,
  input: z.infer<typeof dashboardInput> & {
    organizationId: string;
    ownerId: string;
    status: 'proposed' | 'kept';
  },
): Promise<Dashboard> {
  const { rows } = await db.query<Row>(
    `insert into dashboards (organization_id, dashboard_id, name, description, widgets, audience,
       owner_id, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
    [
      input.organizationId,
      newId('dsh'),
      input.name,
      input.description ?? null,
      JSON.stringify(input.widgets),
      [`user:${input.ownerId}`],
      input.ownerId,
      input.status,
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
      change.widgets ? JSON.stringify(change.widgets) : null,
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
