import { answerQuery, QueryRefused, type DatasetRow } from '@kete/metrics';
import { queryDataset, readMetrics } from '@kete/metrics/server';
import type { Dataset, DatasetQuery, MetricReading } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import type { IdentityVariables } from '../../platform/identity.js';
import { colourOf, type Colour, type Comparison } from '../performance/index.js';
import { listResources } from '../registry/index.js';
import { centerDatasets, centerRows, CENTER } from './center.js';

// The Measure (spec 102; doctrine D-062, R2, R7, R17; kete-core ADR 0015 and spec 144): an
// indicator of the organization names where its figure comes from — the center's own tables, a
// team's table, a form, an app's data set or figure — or that it is typed with a proof. Its reading
// is live, read with the reader's rights and the filters she asks, and says how it was obtained; a
// source that does not answer is missing, never zero, and red where the indicator has a threshold.

type Identity = IdentityVariables['identity'];

let appFetch: typeof fetch | undefined;
/** Tests: reach the apps another way (an app served in memory). */
export function useMeasureFetch(next: typeof fetch | undefined): void {
  appFetch = next;
}
const fetching = (context: { fetch?: typeof fetch }): { fetch?: typeof fetch } => {
  const chosen = context.fetch ?? appFetch;
  return chosen ? { fetch: chosen } : {};
};

export function measureMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
alter table ${s}.indicators
  add column source_ref jsonb,
  add column unit text check (unit in ('count', 'percent', 'money', 'hours', 'days', 'number')),
  add column direction text check (direction in ('higher', 'lower')),
  add column target numeric,
  add column threshold numeric,
  add column alert_when text check (alert_when in ('<', '<=', '>', '>=')),
  add column owner_position_id text,
  add column updated_at timestamptz not null default now();

-- The last colour an organization-wide reading gave, so that turning red is said once (R11).
create table ${s}.indicator_colours (
  organization_id text not null,
  indicator_id text not null,
  colour text check (colour in ('green', 'orange', 'red')),
  value numeric,
  missing boolean not null default false,
  read_at timestamptz not null default now(),
  holding_id text,
  primary key (organization_id, indicator_id),
  foreign key (organization_id, indicator_id)
    references ${s}.indicators (organization_id, indicator_id)
);
${policy('indicator_colours')}
grant select, insert, update on ${s}.indicator_colours to ${options.appRole};

-- A freeze: readings kept as they were, for a board's summary or a quarter's « arrêté » (D-052).
create table ${s}.measure_freezes (
  organization_id text not null,
  freeze_id text not null,
  label text not null check (length(label) between 1 and 120),
  period_from date,
  period_to date,
  filter jsonb not null default '{}'::jsonb,
  readings jsonb not null,
  frozen_by text not null,
  frozen_at timestamptz not null default now(),
  primary key (organization_id, freeze_id)
);
${policy('measure_freezes')}
grant select, insert on ${s}.measure_freezes to ${options.appRole};

-- The worker learns which organizations watch an indicator sourced in the center: identifiers only.
create function ${s}.kete_measure_watched() returns table (organization_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select distinct organization_id from indicators
         where source_ref->>'kind' = 'center' and owner_position_id is not null
           and direction is not null $$;
revoke all on function ${s}.kete_measure_watched() from public;
grant execute on function ${s}.kete_measure_watched() to ${options.appRole};

-- A figure past its threshold says so on the one event path (spec 101).
alter table ${s}.kete_events drop constraint kete_events_source_check;
alter table ${s}.kete_events add constraint kete_events_source_check
  check (source in ('app', 'index', 'measure'));
`;
}

const fieldName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/);
const measure = z.object({
  fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  field: fieldName.optional(),
});
const where = z
  .array(
    z.object({
      field: fieldName,
      op: z.enum(['eq', 'neq', 'gte', 'lte', 'contains']),
      value: z.union([z.string().max(200), z.number()]),
    }),
  )
  .max(10)
  .optional();
/** One number from rows: a measure, filtered; over another, a percentage. */
const counted = {
  measure,
  where,
  /** The same rows' denominator: the figure becomes a percentage. */
  over: z.object({ measure, where }).optional(),
};

export const sourceRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('typed') }),
  z.object({
    kind: z.literal('center'),
    dataset: z.enum(['holdings', 'money', 'assets']),
    ...counted,
  }),
  z.object({
    kind: z.literal('dataset'),
    product: z.string().min(1).max(80),
    dataset: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    ...counted,
  }),
  z.object({
    kind: z.literal('metric'),
    product: z.string().min(1).max(80),
    metric: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  }),
]);
export type SourceRef = z.infer<typeof sourceRef>;

export const indicatorSourceInput = z.object({
  indicatorId: z.string().min(1).max(100),
  source: sourceRef,
  unit: z.enum(['count', 'percent', 'money', 'hours', 'days', 'number']).optional(),
  direction: z.enum(['higher', 'lower']).optional(),
  target: z.number().finite().optional(),
  threshold: z.number().finite().optional(),
  alertWhen: z.enum(['<', '<=', '>', '>=']).optional(),
  ownerPositionId: z.string().min(1).max(100).optional(),
});

export interface Indicator {
  indicatorId: string;
  name: string;
  formula: string;
  /** Its source in words, as the referential wrote it. */
  sourceLabel: string;
  frequency: string;
  leading: boolean;
  source: SourceRef | null;
  unit: string | null;
  direction: 'higher' | 'lower' | null;
  target: number | null;
  threshold: number | null;
  alertWhen: Comparison | null;
  ownerPositionId: string | null;
}

type IndicatorRow = {
  indicator_id: string;
  name: string;
  formula: string;
  source: string;
  frequency: string;
  is_leading: boolean;
  source_ref: SourceRef | null;
  unit: string | null;
  direction: 'higher' | 'lower' | null;
  target: string | null;
  threshold: string | null;
  alert_when: Comparison | null;
  owner_position_id: string | null;
};
const num = (v: string | null) => (v === null ? null : Number(v));
const indicatorOf = (r: IndicatorRow): Indicator => ({
  indicatorId: r.indicator_id,
  name: r.name,
  formula: r.formula,
  sourceLabel: r.source,
  frequency: r.frequency,
  leading: r.is_leading,
  source: r.source_ref,
  unit: r.unit,
  direction: r.direction,
  target: num(r.target),
  threshold: num(r.threshold),
  alertWhen: r.alert_when,
  ownerPositionId: r.owner_position_id,
});
const COLUMNS = `indicator_id, name, formula, source, frequency, is_leading, source_ref, unit,
  direction, target, threshold, alert_when, owner_position_id`;

export async function listIndicators(db: SqlExecutor): Promise<Indicator[]> {
  const { rows } = await db.query<IndicatorRow>(`select ${COLUMNS} from indicators order by name`);
  return rows.map(indicatorOf);
}

export async function findIndicator(db: SqlExecutor, id: string): Promise<Indicator | null> {
  const { rows } = await db.query<IndicatorRow>(
    `select ${COLUMNS} from indicators where indicator_id = $1`,
    [id],
  );
  return rows[0] ? indicatorOf(rows[0]) : null;
}

/** The axes a reader may ask a reading on: the center's four. */
export interface ReadingFilter {
  project_id?: string;
  party_id?: string;
  unit_id?: string;
  person_id?: string;
}

export interface Reading {
  indicatorId: string;
  name: string;
  value: number | null;
  /** done: read; missing: its source did not answer; denied: not hers; typed: no live source. */
  status: 'done' | 'missing' | 'denied' | 'typed' | 'refused';
  colour: Colour | null;
  unit: string | null;
  target: number | null;
  threshold: number | null;
  leading: boolean;
  /** « D'où vient ce chiffre ? »: the source, the filters applied, the period, the rows counted. */
  provenance: {
    source: string;
    filter: ReadingFilter;
    period: { from: string; to: string } | null;
    counted: number | null;
    at: string;
  };
}

/** The sources she may build an indicator on: the center's, and her apps' data sets and figures. */
export async function sourcesFor(db: SqlExecutor) {
  const apps = (await listResources(db)).filter(
    (r) => r.kind === 'app' && r.status === 'active' && r.card,
  );
  type Card = { product: string; datasets?: Dataset[]; metrics?: { name: string }[] };
  return {
    center: centerDatasets.map((d) => ({ product: CENTER, ...d })),
    apps: apps.map((r) => {
      const card = r.card as unknown as Card;
      return {
        product: card.product,
        name: r.name,
        datasets: card.datasets ?? [],
        metrics: (card.metrics ?? []).map((m) => m.name),
      };
    }),
  };
}

const questionOf = (
  m: z.infer<typeof measure>,
  w: z.infer<typeof where>,
  filter: ReadingFilter,
  period: { from: string; to: string } | null,
): DatasetQuery => ({
  filter: filter as NonNullable<DatasetQuery['filter']>,
  ...(w?.length ? { where: w as NonNullable<DatasetQuery['where']> } : {}),
  measures: [{ fn: m.fn, ...(m.field ? { field: m.field } : {}) }],
  ...(period ? { from: period.from, to: period.to } : {}),
});
const firstValue = (rows: Record<string, unknown>[]) => {
  const v = Object.entries(rows[0] ?? {}).find(([k]) => k.includes('(') || k === 'count')?.[1];
  return typeof v === 'number' ? v : null;
};

/** Where an app is reached: its declared API, else beside its address. */
function apiOf(resource: { address: string | null; card: unknown }): string | null {
  const endpoints = (resource.card as { endpoints?: { api?: string } } | null)?.endpoints;
  if (endpoints?.api) return endpoints.api;
  return resource.address ? `${resource.address.replace(/\/$/, '')}/api/v1` : null;
}

/** The context a reading needs: her identity and, for an app, her token and a way to reach it. */
export interface ReadingContext {
  db: SqlExecutor;
  identity: Identity;
  /** Her bearer token, for the apps; none for the worker, which reads the center only. */
  token: string | null;
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * Reads an indicator live for her: its source, with her rights and the filters she asks, over the
 * period. What it applied and where it came from travel with the value.
 */
export async function readIndicator(
  context: ReadingContext,
  indicator: Indicator,
  options: { filter?: ReadingFilter; period?: { from: string; to: string } | null } = {},
): Promise<Reading> {
  const at = (context.now ?? (() => new Date()))().toISOString();
  const period = options.period ?? null;
  const asked = Object.fromEntries(
    Object.entries(options.filter ?? {}).filter(([, v]) => Boolean(v)),
  ) as ReadingFilter;
  const base = {
    indicatorId: indicator.indicatorId,
    name: indicator.name,
    unit: indicator.unit,
    target: indicator.target,
    threshold: indicator.threshold,
    leading: indicator.leading,
  };
  const colour = (value: number | null, status: Reading['status']) =>
    status === 'denied' || status === 'refused'
      ? null
      : colourOf(
          {
            direction: indicator.direction,
            target: indicator.target,
            threshold: indicator.threshold,
            alertWhen: indicator.alertWhen,
          },
          value,
        );
  const done = (
    value: number | null,
    status: Reading['status'],
    source: string,
    filter: ReadingFilter,
    counted: number | null,
  ): Reading => ({
    ...base,
    value,
    status,
    // Nothing to count for her is no colour; a source that does not answer is red (R17).
    colour:
      (status === 'typed' && indicator.direction === null) || (status === 'done' && value === null)
        ? null
        : colour(value, status),
    provenance: { source, filter, period, counted, at },
  });
  const source = indicator.source;
  if (!source || source.kind === 'typed') {
    return done(null, 'typed', indicator.sourceLabel, {}, null);
  }

  if (source.kind === 'metric') {
    const app = (await listResources(context.db)).find(
      (r) => r.kind === 'app' && r.status === 'active' && r.card?.product === source.product,
    );
    const label = `${app?.name ?? source.product} · ${source.metric}`;
    if (!app?.address || !context.token) return done(null, 'missing', label, {}, null);
    const [reading] = await readMetrics({
      url: app.address,
      token: context.token,
      names: [source.metric],
      ...(asked.project_id || asked.party_id || asked.unit_id || asked.person_id
        ? { filter: asked }
        : {}),
      ...fetching(context),
    });
    const r = reading as MetricReading | undefined;
    if (!r || r.missing) return done(null, 'missing', label, {}, null);
    if (r.denied) return done(null, 'denied', label, {}, null);
    return done(r.value, 'done', label, (r.filter ?? {}) as ReadingFilter, null);
  }

  // A data set: one number from its rows, or a percentage of two.
  const sum = async (m: z.infer<typeof measure>, w: z.infer<typeof where>) => {
    const question = questionOf(m, w, asked, period);
    if (source.kind === 'center') {
      const dataset = centerDatasets.find((d) => d.name === source.dataset) as Dataset;
      const rows = (await centerRows(
        context.db,
        context.identity,
        source.dataset,
        period ?? {},
      )) as DatasetRow[] | null;
      if (!rows) return { status: 'missing' as const };
      try {
        return { status: 'done' as const, answer: answerQuery(dataset, rows, question) };
      } catch (error) {
        if (error instanceof QueryRefused) return { status: 'refused' as const };
        throw error;
      }
    }
    const app = (await listResources(context.db)).find(
      (r) => r.kind === 'app' && r.status === 'active' && r.card?.product === source.product,
    );
    const api = app ? apiOf(app) : null;
    if (!api || !context.token) return { status: 'missing' as const };
    const asked2 = await queryDataset({
      api,
      token: context.token,
      dataset: source.dataset,
      query: question,
      ...fetching(context),
    });
    if (asked2.status === 'refused') {
      return {
        status: asked2.reason === 'not_allowed' ? ('denied' as const) : ('refused' as const),
      };
    }
    return asked2;
  };
  const label =
    source.kind === 'center'
      ? `Kete · ${source.dataset}`
      : `${
          (await listResources(context.db)).find((r) => r.card?.product === source.product)?.name ??
          source.product
        } · ${source.dataset}`;
  const top = await sum(source.measure, source.where);
  if (top.status !== 'done') return done(null, top.status, label, {}, null);
  let value = firstValue(top.answer.rows);
  if (source.over) {
    const bottom = await sum(source.over.measure, source.over.where);
    if (bottom.status !== 'done') return done(null, bottom.status, label, {}, null);
    const over = firstValue(bottom.answer.rows);
    value = value === null || !over ? null : Math.round((value / over) * 1000) / 10;
  }
  return done(value, 'done', label, top.answer.filter as ReadingFilter, top.answer.counted);
}
