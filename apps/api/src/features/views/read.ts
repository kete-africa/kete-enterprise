import { answerQuery, QueryRefused, type DatasetRow } from '@kete/metrics';
import { queryDataset, readMetrics } from '@kete/metrics/server';
import type { DatasetQuery, View } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import type { IdentityVariables } from '../../platform/identity.js';
import {
  centerDatasets,
  centerRows,
  listIndicators,
  readIndicator,
  type Reading,
  type ReadingFilter,
} from '../measure/index.js';
import { findObjects, kindsOf, titlesOf } from '../objects/index.js';
import { listResources } from '../registry/index.js';
import { viewWords } from './words.js';

// What a view shows, read for her (spec 103; ADR 0015, 0016): its source with her rights, the
// filters the place and the board bind, the period. Axis ids are named — a unit, a project, a third
// party she may not open is still named by what it is. What is not known is said, never a zero.

type Identity = IdentityVariables['identity'];

export interface ViewData {
  state: 'done' | 'empty' | 'missing' | 'denied';
  rows: Record<string, string | number | boolean | null>[];
  readings: Reading[];
  provenance: { source: string; filter: ReadingFilter; counted: number | null; at: string } | null;
}

const AXIS_FIELDS: Record<string, string> = {
  project_id: 'project',
  party_id: 'party',
  unit_id: 'unit',
};

/** The words of the center's measures, for a legend: never `sum(amount)`. */
const MEASURES: Record<string, string> = viewWords().fr.measures;

/**
 * What a reader reads in a card's groups: a unit, a project, a third party by its name; an object's
 * kind and an asset's state by their words; a measure by its name.
 */
async function named(
  db: SqlExecutor,
  dataset: string | null,
  rows: ViewData['rows'],
): Promise<ViewData['rows']> {
  const refs = rows.flatMap((r) =>
    Object.entries(AXIS_FIELDS).flatMap(([field, kind]) =>
      typeof r[field] === 'string' ? [{ kind, id: r[field] as string }] : [],
    ),
  );
  const titles = refs.length ? await titlesOf(db, refs) : {};
  const kinds = dataset ? await kindsOf(db) : [];
  const kindWord = (kind: string) => kinds.find((k) => k.kind === kind)?.label.fr ?? kind;
  const stateWord = (state: string) =>
    kinds.find((k) => k.kind === 'asset')?.states.find((st) => st.id === state)?.label.fr ?? state;
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => {
        const kind = AXIS_FIELDS[k];
        const value =
          kind && typeof v === 'string'
            ? (titles[`${kind}:${v}`] ?? v)
            : k === 'object_kind' && typeof v === 'string'
              ? kindWord(v)
              : k === 'state' && dataset === 'assets' && typeof v === 'string'
                ? stateWord(v)
                : v;
        return [MEASURES[k] ?? k, value];
      }),
    ),
  );
}

/** Reads a view's source for her, within her organization's transaction. */
export async function readView(
  context: { db: SqlExecutor; identity: Identity; token: string | null; fetch?: typeof fetch },
  view: View,
  options: { filter: ReadingFilter; period: { from: string; to: string } | null },
): Promise<ViewData> {
  const { db } = context;
  const at = new Date().toISOString();
  const source = view.source;
  const none: ViewData = { state: 'empty', rows: [], readings: [], provenance: null };
  if (!source) return none;

  if ('indicators' in source) {
    const all = await listIndicators(db);
    const wanted = source.indicators.flatMap((id) => all.filter((i) => i.indicatorId === id));
    const readings: Reading[] = [];
    for (const indicator of wanted) {
      readings.push(await readIndicator(context, indicator, options));
    }
    return { state: readings.length ? 'done' : 'empty', rows: [], readings, provenance: null };
  }

  if ('dataset' in source) {
    const question: DatasetQuery = {
      filter: options.filter as NonNullable<DatasetQuery['filter']>,
      ...(view.filters?.length
        ? {
            where: view.filters.flatMap((f) =>
              f.op && f.value !== undefined ? [{ field: f.field, op: f.op, value: f.value }] : [],
            ) as NonNullable<DatasetQuery['where']>,
          }
        : {}),
      ...(source.group_by?.length
        ? { group_by: source.group_by as NonNullable<DatasetQuery['group_by']> }
        : {}),
      measures: (source.measures ?? [{ fn: 'count' }]) as DatasetQuery['measures'],
      ...(options.period ? { from: options.period.from, to: options.period.to } : {}),
    };
    if (!source.product || source.product === 'center') {
      const dataset = centerDatasets.find((d) => d.name === source.dataset);
      if (!dataset) return { ...none, state: 'missing' };
      const rows = (await centerRows(
        db,
        context.identity,
        source.dataset,
        options.period ?? {},
      )) as DatasetRow[] | null;
      if (!rows) return { ...none, state: 'missing' };
      try {
        const answer = answerQuery(dataset, rows, question);
        return {
          state: answer.counted === 0 ? 'empty' : 'done',
          rows: await named(db, source.dataset, answer.rows),
          readings: [],
          provenance: {
            source: `Kete · ${source.dataset}`,
            filter: answer.filter as ReadingFilter,
            counted: answer.counted,
            at,
          },
        };
      } catch (error) {
        if (error instanceof QueryRefused) return { ...none, state: 'missing' };
        throw error;
      }
    }
    const app = (await listResources(db)).find(
      (r) => r.kind === 'app' && r.status === 'active' && r.card?.product === source.product,
    );
    const api =
      (app?.card as { endpoints?: { api?: string } } | null | undefined)?.endpoints?.api ??
      (app?.address ? `${app.address.replace(/\/$/, '')}/api/v1` : null);
    if (!app || !api || !context.token) return { ...none, state: 'missing' };
    const asked = await queryDataset({
      api,
      token: context.token,
      dataset: source.dataset,
      query: question,
      ...(context.fetch ? { fetch: context.fetch } : {}),
    });
    if (asked.status === 'missing') return { ...none, state: 'missing' };
    if (asked.status === 'refused') return { ...none, state: 'denied' };
    return {
      state: asked.answer.counted === 0 ? 'empty' : 'done',
      rows: await named(db, null, asked.answer.rows),
      readings: [],
      provenance: {
        source: `${app.name} · ${source.dataset}`,
        filter: asked.answer.filter as ReadingFilter,
        counted: asked.answer.counted,
        at,
      },
    };
  }

  if ('metric' in source) {
    const product = source.metric.split('.')[0] ?? '';
    const app = (await listResources(db)).find(
      (r) =>
        r.kind === 'app' &&
        r.status === 'active' &&
        (r.card as { metrics?: { name: string }[] } | null)?.metrics?.some(
          (m) => m.name === source.metric,
        ),
    );
    if (!app?.address || !context.token) return { ...none, state: 'missing' };
    const [reading] = await readMetrics({
      url: app.address,
      token: context.token,
      names: [source.metric],
      ...(context.fetch ? { fetch: context.fetch } : {}),
    });
    if (!reading || reading.missing) return { ...none, state: 'missing' };
    if (reading.denied) return { ...none, state: 'denied' };
    return {
      state: 'done',
      rows: [{ [source.metric]: reading.value }],
      readings: [],
      provenance: {
        source: `${app.name || product} · ${source.metric}`,
        filter: {},
        counted: null,
        at,
      },
    };
  }

  if ('objects' in source) {
    const found = await findObjects(db, context.identity, {
      kind: source.objects,
      projectId: options.filter.project_id,
      partyId: options.filter.party_id,
      unitId: options.filter.unit_id,
      personId: options.filter.person_id,
      limit: 200,
    });
    return {
      state: found.length ? 'done' : 'empty',
      rows: found.map((o) => ({ id: o.id, title: o.title, state: o.stateLabel ?? o.state })),
      readings: [],
      provenance: {
        source: `Kete · ${source.objects}`,
        filter: options.filter,
        counted: found.length,
        at,
      },
    };
  }
  return none;
}
