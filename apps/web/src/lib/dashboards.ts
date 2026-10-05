import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Dashboards (spec 033), as the API serves them.

export type View = 'number' | 'bar' | 'line' | 'pie' | 'table';
export type Fn = 'count' | 'sum' | 'avg' | 'min' | 'max';
export interface Widget {
  title: string;
  source: { kind: 'dataset' | 'form'; id: string };
  query: { groupBy?: string[]; measures: { fn: Fn; column?: string }[] };
  view: View;
}
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
type Cell = number | string | null;
export type Card =
  | { title: string; view: View; visible: true; source: string; rows: Record<string, Cell>[] }
  | { title: string; view: View; visible: false };

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown) => {
  const id = text(value, 80);
  if (!/^dsh_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which dashboard?');
  return id;
};
const views = ['number', 'bar', 'line', 'pie', 'table'] as const;
const fns = ['count', 'sum', 'avg', 'min', 'max'] as const;
/** Cards as the API takes them: titles, sources, small queries, views. */
const widgetsOf = (value: unknown): Widget[] =>
  (Array.isArray(value) ? value : []).slice(0, 12).map((raw) => {
    const w = (raw ?? {}) as Record<string, unknown>;
    const source = (w.source ?? {}) as Record<string, unknown>;
    const query = (w.query ?? {}) as Record<string, unknown>;
    return {
      title: text(w.title, 160),
      source: { kind: source.kind === 'form' ? 'form' : 'dataset', id: text(source.id, 80) },
      query: {
        groupBy: (Array.isArray(query.groupBy) ? query.groupBy : [])
          .filter((g): g is string => typeof g === 'string')
          .slice(0, 3),
        measures: (Array.isArray(query.measures) ? query.measures : []).slice(0, 6).map((m) => {
          const measure = (m ?? {}) as Record<string, unknown>;
          const fn = fns.find((f) => f === measure.fn) ?? 'count';
          return {
            fn,
            ...(typeof measure.column === 'string' && measure.column
              ? { column: measure.column }
              : {}),
          };
        }),
      },
      view: views.find((v) => v === w.view) ?? 'table',
    };
  });
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

export const fetchDashboards = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ dashboards: Dashboard[] }>(getRequest(), '/v1/dashboards'),
);

export const fetchDashboard = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    dashboardId: idOf((input as { dashboardId?: unknown } | null)?.dashboardId),
  }))
  .handler(({ data }) =>
    callApi<{ dashboard: Dashboard; manage: boolean; pinned: boolean; cards: Card[] }>(
      getRequest(),
      `/v1/dashboards/${data.dashboardId}`,
    ),
  );

export const createDashboard = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { name: text(v.name, 160), widgets: widgetsOf(v.widgets) };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ dashboard: Dashboard }>(
        getRequest(),
        '/v1/dashboards',
        data,
        crypto.randomUUID(),
      ),
    ),
  );

/** She pins a dashboard on her « Aujourd'hui », or unpins it (spec 046). */
export const pinDashboard = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { dashboardId: idOf(v.dashboardId), pinned: v.pinned === true };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ pinned: boolean }>(
        getRequest(),
        `/v1/dashboards/${data.dashboardId}/pin`,
        { pinned: data.pinned },
        crypto.randomUUID(),
      ),
    ),
  );

/** A gesture on a dashboard: new cards, kept, opened, removed. */
export const dashboardGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const audience =
      v.audience === 'everyone'
        ? ['everyone']
        : typeof v.audience === 'string' && /^user:[A-Za-z0-9_.-]{1,80}$/.test(v.audience)
          ? [v.audience]
          : null;
    return {
      dashboardId: idOf(v.dashboardId),
      remove: v.remove === true,
      keep: v.keep === true,
      audience,
      widgets: v.widgets === undefined ? null : widgetsOf(v.widgets),
    };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ removed?: boolean }>(
        getRequest(),
        data.remove
          ? `/v1/dashboards/${data.dashboardId}/remove`
          : `/v1/dashboards/${data.dashboardId}`,
        data.remove
          ? {}
          : {
              ...(data.keep ? { keep: true } : {}),
              ...(data.audience ? { audience: data.audience } : {}),
              ...(data.widgets ? { widgets: data.widgets } : {}),
            },
        crypto.randomUUID(),
      ),
    ),
  );
