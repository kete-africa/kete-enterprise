import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// A team's data (spec 031): its tables — a spreadsheet, a CSV — kept as rows in the organization's
// Postgres, described as the apps' data sets are (dataset.v1: a time field, measures, dimensions),
// read by the people its audience opens it to, and summed up by the same small query everywhere:
// the assistant, the screens, the dashboards.

export function datasetsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.team_datasets (
  organization_id text not null,
  dataset_id text not null,
  name text not null check (length(name) between 1 and 160),
  description text check (length(description) <= 1000),
  columns jsonb not null,
  time_column text,
  audience text[] not null check (cardinality(audience) between 1 and 200),
  owner_id text not null,
  source_name text,
  row_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, dataset_id)
);
${policy('team_datasets')}
grant select, insert, update, delete on ${s}.team_datasets to ${options.appRole};

create table ${s}.team_dataset_rows (
  organization_id text not null,
  dataset_id text not null,
  ordinal integer not null,
  data jsonb not null,
  primary key (organization_id, dataset_id, ordinal),
  foreign key (organization_id, dataset_id)
    references ${s}.team_datasets (organization_id, dataset_id) on delete cascade
);
${policy('team_dataset_rows')}
grant select, insert, delete on ${s}.team_dataset_rows to ${options.appRole};
`;
}

export type ColumnType = 'number' | 'date' | 'text';
export interface Column {
  name: string;
  type: ColumnType;
}
export type Row = Record<string, number | string | null>;

export interface TeamDataset {
  datasetId: string;
  name: string;
  description: string | null;
  columns: Column[];
  /** The column that dates a row (dataset.v1 `time`): its first date column. */
  timeColumn: string | null;
  /** Its numbers (dataset.v1 `measures`) and its texts (`dimensions`). */
  measures: string[];
  dimensions: string[];
  audience: string[];
  ownerId: string;
  sourceName: string | null;
  rowCount: number;
  updatedAt: string;
}

type DatasetRow = {
  dataset_id: string;
  name: string;
  description: string | null;
  columns: Column[];
  time_column: string | null;
  audience: string[];
  owner_id: string;
  source_name: string | null;
  row_count: number;
  updated_at: Date;
};
const datasetOf = (r: DatasetRow): TeamDataset => ({
  datasetId: r.dataset_id,
  name: r.name,
  description: r.description,
  columns: r.columns,
  timeColumn: r.time_column,
  measures: r.columns.filter((c) => c.type === 'number').map((c) => c.name),
  dimensions: r.columns.filter((c) => c.type === 'text').map((c) => c.name),
  audience: r.audience,
  ownerId: r.owner_id,
  sourceName: r.source_name,
  rowCount: r.row_count,
  updatedAt: r.updated_at.toISOString(),
});
const COLUMNS = `dataset_id, name, description, columns, time_column, audience, owner_id,
  source_name, row_count, updated_at`;

/** A table's rows replace the data set's, in one statement; its columns follow the table. */
export async function replaceRows(
  db: SqlExecutor,
  input: {
    organizationId: string;
    datasetId: string;
    columns: Column[];
    rows: Row[];
    sourceName: string | null;
  },
): Promise<void> {
  await db.query(`delete from team_dataset_rows where dataset_id = $1`, [input.datasetId]);
  await db.query(
    `insert into team_dataset_rows (organization_id, dataset_id, ordinal, data)
     select $1, $2, (r.ordinality - 1)::int, r.value
       from jsonb_array_elements($3::jsonb) with ordinality as r(value, ordinality)`,
    [input.organizationId, input.datasetId, JSON.stringify(input.rows)],
  );
  await db.query(
    `update team_datasets set columns = $2, time_column = $3, row_count = $4, source_name = $5,
       updated_at = now() where dataset_id = $1`,
    [
      input.datasetId,
      JSON.stringify(input.columns),
      input.columns.find((c) => c.type === 'date')?.name ?? null,
      input.rows.length,
      input.sourceName,
    ],
  );
}

export async function createDataset(
  db: SqlExecutor,
  input: {
    organizationId: string;
    name: string;
    description?: string | undefined;
    ownerId: string;
    audience: string[];
    columns: Column[];
    rows: Row[];
    sourceName: string | null;
  },
): Promise<TeamDataset> {
  const datasetId = newId('tds');
  await db.query(
    `insert into team_datasets (organization_id, dataset_id, name, description, columns, audience, owner_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.organizationId,
      datasetId,
      input.name,
      input.description ?? null,
      JSON.stringify(input.columns),
      input.audience,
      input.ownerId,
    ],
  );
  await replaceRows(db, { ...input, datasetId });
  return (await getDataset(db, datasetId)) as TeamDataset;
}

export async function getDataset(db: SqlExecutor, datasetId: string): Promise<TeamDataset | null> {
  const { rows } = await db.query<DatasetRow>(
    `select ${COLUMNS} from team_datasets where dataset_id = $1`,
    [datasetId],
  );
  return rows[0] ? datasetOf(rows[0]) : null;
}

/** The data sets a reader's keys open; all of them for an administrator. */
export async function listDatasets(
  db: SqlExecutor,
  readerKeys: string[] | null,
): Promise<TeamDataset[]> {
  const { rows } = await db.query<DatasetRow>(
    `select ${COLUMNS} from team_datasets
      where $1::text[] is null or audience && $1::text[] order by name`,
    [readerKeys],
  );
  return rows.map(datasetOf);
}

export async function updateDataset(
  db: SqlExecutor,
  datasetId: string,
  change: { name?: string; description?: string; audience?: string[] },
): Promise<TeamDataset | null> {
  await db.query(
    `update team_datasets set name = coalesce($2, name), description = coalesce($3, description),
       audience = coalesce($4, audience), updated_at = now() where dataset_id = $1`,
    [datasetId, change.name ?? null, change.description ?? null, change.audience ?? null],
  );
  return getDataset(db, datasetId);
}

export async function removeDataset(db: SqlExecutor, datasetId: string): Promise<boolean> {
  const { rows } = await db.query(
    `delete from team_datasets where dataset_id = $1 returning dataset_id`,
    [datasetId],
  );
  return rows.length > 0;
}

/** Its rows, dated between `from` and `to` on its time column when it has one, at most `limit`. */
export async function readRows(
  db: SqlExecutor,
  dataset: TeamDataset,
  query: { from?: string | undefined; to?: string | undefined; limit: number },
): Promise<{ rows: Row[]; truncated: boolean }> {
  const time = dataset.timeColumn;
  const { rows } = await db.query<{ data: Row }>(
    `select data from team_dataset_rows
      where dataset_id = $1
        and ($2::text is null or $3::date is null or (data->>$2)::date >= $3::date)
        and ($2::text is null or $4::date is null or (data->>$2)::date <= $4::date)
      order by ordinal limit $5`,
    [dataset.datasetId, time, query.from ?? null, query.to ?? null, query.limit + 1],
  );
  return {
    rows: rows.slice(0, query.limit).map((r) => r.data),
    truncated: rows.length > query.limit,
  };
}

/** The small query every reader of a data set uses: filters, groups, measures. */
export const querySpec = z.object({
  filters: z
    .array(
      z.object({
        column: z.string().min(1).max(80),
        op: z.enum(['eq', 'neq', 'gte', 'lte', 'contains']),
        value: z.union([z.string().max(200), z.number()]),
      }),
    )
    .max(10)
    .default([]),
  groupBy: z.array(z.string().min(1).max(80)).max(3).default([]),
  measures: z
    .array(
      z.object({
        fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
        column: z.string().min(1).max(80).optional(),
      }),
    )
    .min(1)
    .max(6)
    .default([{ fn: 'count' }]),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type QuerySpec = z.infer<typeof querySpec>;

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryError';
  }
}

const measureName = (m: QuerySpec['measures'][number]) =>
  m.fn === 'count' && !m.column ? 'count' : `${m.fn}(${m.column ?? ''})`;

/**
 * The rows summed up: those passing the filters, grouped by up to three columns, each group with
 * its measures — the largest first. Only the data set's own columns are named.
 */
export function aggregate(columns: Column[], rows: Row[], spec: QuerySpec): Row[] {
  const types = new Map(columns.map((c) => [c.name, c.type]));
  const named = [
    ...spec.filters.map((f) => f.column),
    ...spec.groupBy,
    ...spec.measures.flatMap((m) => (m.column ? [m.column] : [])),
  ];
  const unknown = named.filter((n) => !types.has(n));
  if (unknown.length) throw new QueryError(`Unknown columns: ${unknown.join(', ')}`);
  for (const m of spec.measures) {
    if (m.fn !== 'count' && (!m.column || types.get(m.column) !== 'number')) {
      throw new QueryError(`${m.fn} needs a number column.`);
    }
  }
  const passes = (row: Row) =>
    spec.filters.every((f) => {
      const v = row[f.column];
      if (v === null || v === undefined) return f.op === 'neq';
      switch (f.op) {
        case 'eq':
          return String(v).toLowerCase() === String(f.value).toLowerCase();
        case 'neq':
          return String(v).toLowerCase() !== String(f.value).toLowerCase();
        case 'gte':
          return typeof v === 'number' ? v >= Number(f.value) : String(v) >= String(f.value);
        case 'lte':
          return typeof v === 'number' ? v <= Number(f.value) : String(v) <= String(f.value);
        case 'contains':
          return String(v).toLowerCase().includes(String(f.value).toLowerCase());
      }
    });
  const groups = new Map<string, { key: Row; rows: Row[] }>();
  for (const row of rows.filter(passes)) {
    const key = Object.fromEntries(spec.groupBy.map((g) => [g, row[g] ?? null]));
    const id = JSON.stringify(key);
    const group = groups.get(id) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  const result = [...groups.values()].map(({ key, rows: members }) => {
    const out: Row = { ...key };
    for (const m of spec.measures) {
      const values = m.column
        ? members
            .map((r) => r[m.column as string])
            .filter((v): v is number => typeof v === 'number')
        : [];
      const sum = values.reduce((a, b) => a + b, 0);
      out[measureName(m)] =
        m.fn === 'count'
          ? m.column
            ? values.length
            : members.length
          : values.length === 0
            ? null
            : m.fn === 'sum'
              ? round(sum)
              : m.fn === 'avg'
                ? round(sum / values.length)
                : m.fn === 'min'
                  ? Math.min(...values)
                  : Math.max(...values);
    }
    return out;
  });
  const first = measureName(spec.measures[0] as QuerySpec['measures'][number]);
  return result
    .sort((a, b) => Number(b[first] ?? -Infinity) - Number(a[first] ?? -Infinity))
    .slice(0, spec.limit);
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
