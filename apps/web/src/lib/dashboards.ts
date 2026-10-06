import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Dashboards (specs 033, 050), as the API serves them.

export type View = 'number' | 'bar' | 'line' | 'pie' | 'table';
export type Fn = 'count' | 'sum' | 'avg' | 'min' | 'max';
export interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Goal {
  value: number;
  better: 'up' | 'down';
}
interface WidgetBase {
  id?: string;
  title: string;
  place?: Place;
  proposed?: boolean;
}
export interface DataWidget extends WidgetBase {
  kind?: 'data';
  source: { kind: 'dataset' | 'form'; id: string };
  query: {
    filters?: {
      column: string;
      op: 'eq' | 'neq' | 'gte' | 'lte' | 'contains';
      value: string | number;
    }[];
    groupBy?: string[];
    measures: { fn: Fn; column?: string }[];
  };
  view: View;
  goal?: Goal;
  threshold?: number;
}
export interface NoteWidget extends WidgetBase {
  kind: 'note';
  text: string;
}
export type Widget = DataWidget | NoteWidget;
export interface Dashboard {
  dashboardId: string;
  name: string;
  description: string | null;
  widgets: Widget[];
  audience: string[];
  ownerId: string;
  status: 'proposed' | 'kept';
  forkedFrom: string | null;
  updatedAt: string;
}
type Cell = number | string | null;
interface CardBase {
  id: string;
  title: string;
  place: Place | null;
  proposed: boolean;
}
export type DataCard =
  | (CardBase & {
      kind: 'data';
      view: View;
      visible: true;
      source: string;
      rows: Record<string, Cell>[];
      previous: Record<string, Cell>[] | null;
      filtered: boolean | null;
      goal: Goal | null;
      threshold: number | null;
    })
  | (CardBase & { kind: 'data'; view: View; visible: false });
export type Card = (CardBase & { kind: 'note'; text: string }) | DataCard;

/** How she looks at a dashboard: hers, in the address, never saved with it. */
export interface Board {
  period: 'all' | '7d' | '30d' | '90d';
  compare: boolean;
  filter: { column: string; value: string } | null;
}
export const periods: Board['period'][] = ['7d', '30d', '90d', 'all'];

export interface DashboardVersion {
  version: number;
  name: string;
  cardCount: number;
  savedBy: string;
  savedAt: string;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const idOf = (value: unknown) => {
  const id = text(value, 80);
  if (!/^dsh_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which dashboard?');
  return id;
};
const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const int = (value: unknown, min: number, max: number) => {
  const n = finite(value);
  return n === undefined ? min : Math.min(max, Math.max(min, Math.round(n)));
};
const views = ['number', 'bar', 'line', 'pie', 'table'] as const;
const fns = ['count', 'sum', 'avg', 'min', 'max'] as const;
const ops = ['eq', 'neq', 'gte', 'lte', 'contains'] as const;
const placeOf = (value: unknown): Place | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  return { x: int(p.x, 0, 11), y: int(p.y, 0, 500), w: int(p.w, 1, 12), h: int(p.h, 1, 12) };
};
/** Cards as the API takes them: notes, or titles, sources, small queries, views. */
const widgetsOf = (value: unknown): Widget[] =>
  (Array.isArray(value) ? value : []).slice(0, 24).map((raw): Widget => {
    const w = (raw ?? {}) as Record<string, unknown>;
    const id = typeof w.id === 'string' && /^w[0-9a-z]{1,24}$/.test(w.id) ? w.id : undefined;
    const place = placeOf(w.place);
    const base = {
      ...(id ? { id } : {}),
      title: text(w.title, 160),
      ...(place ? { place } : {}),
      ...(w.proposed === true ? { proposed: true } : {}),
    };
    if (w.kind === 'note') return { ...base, kind: 'note', text: text(w.text, 4000) };
    const source = (w.source ?? {}) as Record<string, unknown>;
    const query = (w.query ?? {}) as Record<string, unknown>;
    const goal = (w.goal ?? null) as Record<string, unknown> | null;
    const goalValue = goal ? finite(goal.value) : undefined;
    const threshold = finite(w.threshold);
    return {
      ...base,
      source: { kind: source.kind === 'form' ? 'form' : 'dataset', id: text(source.id, 80) },
      query: {
        filters: (Array.isArray(query.filters) ? query.filters : []).slice(0, 10).flatMap((f) => {
          const filter = (f ?? {}) as Record<string, unknown>;
          const op = ops.find((o) => o === filter.op);
          const v = typeof filter.value === 'number' ? filter.value : text(filter.value, 200);
          return op && typeof filter.column === 'string'
            ? [{ column: filter.column.slice(0, 80), op, value: v }]
            : [];
        }),
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
      ...(goalValue !== undefined
        ? { goal: { value: goalValue, better: goal?.better === 'up' ? 'up' : 'down' } }
        : {}),
      ...(threshold !== undefined ? { threshold } : {}),
    };
  });
const answerOf = <T>(answer: { ok: boolean; data?: T; error?: string | null }) =>
  answer.ok
    ? { ok: true as const, data: (answer.data ?? null) as T | null, error: null }
    : { ok: false as const, data: null, error: answer.error ?? null };

/** Her board from the address: a period, a comparison, a filter set by a click. */
export function boardOf(search: Record<string, unknown>): Board {
  const period = periods.find((p) => p === search['period']) ?? 'all';
  const filter = /^([^:]{1,80}):(.{1,200})$/.exec(
    typeof search['filter'] === 'string' ? search['filter'] : '',
  );
  return {
    period,
    compare: search['compare'] === '1' || search['compare'] === 1,
    filter: filter ? { column: filter[1] ?? '', value: filter[2] ?? '' } : null,
  };
}
const boardQuery = (board: Board) => {
  const q = new URLSearchParams();
  if (board.period !== 'all') q.set('period', board.period);
  if (board.compare) q.set('compare', '1');
  if (board.filter) q.set('filter', `${board.filter.column}:${board.filter.value}`);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const fetchDashboards = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ dashboards: Dashboard[] }>(getRequest(), '/v1/dashboards'),
);

export const fetchDashboard = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      dashboardId: idOf(v.dashboardId),
      board: boardOf((v.board ?? {}) as Record<string, unknown>),
    };
  })
  .handler(({ data }) =>
    callApi<{ dashboard: Dashboard; manage: boolean; pinned: boolean; cards: Card[] }>(
      getRequest(),
      `/v1/dashboards/${data.dashboardId}${boardQuery(data.board)}`,
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

/** A gesture on a dashboard: its name and cards, kept, opened, removed. */
export const dashboardGesture = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const audience =
      v.audience === 'everyone'
        ? ['everyone']
        : typeof v.audience === 'string' && /^user:[A-Za-z0-9_.-]{1,80}$/.test(v.audience)
          ? [v.audience]
          : null;
    const name = text(v.name, 160).trim();
    return {
      dashboardId: idOf(v.dashboardId),
      remove: v.remove === true,
      keep: v.keep === true,
      audience,
      name: name || null,
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
              ...(data.name ? { name: data.name } : {}),
              ...(data.widgets ? { widgets: data.widgets } : {}),
            },
        crypto.randomUUID(),
      ),
    ),
  );

/** A reader makes her own version of a dashboard (spec 050). */
export const forkDashboard = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const name = text(v.name, 160).trim();
    return { dashboardId: idOf(v.dashboardId), name: name || null };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ dashboard: Dashboard }>(
        getRequest(),
        `/v1/dashboards/${data.dashboardId}/fork`,
        data.name ? { name: data.name } : {},
        crypto.randomUUID(),
      ),
    ),
  );

/** Its kept versions, for its owner. */
export const fetchVersions = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    dashboardId: idOf((input as { dashboardId?: unknown } | null)?.dashboardId),
  }))
  .handler(({ data }) =>
    callApi<{ versions: DashboardVersion[] }>(
      getRequest(),
      `/v1/dashboards/${data.dashboardId}/versions`,
    ),
  );

/** Back to a version; the state it leaves is kept as a version too. */
export const restoreVersion = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { dashboardId: idOf(v.dashboardId), version: int(v.version, 1, 1_000_000) };
  })
  .handler(async ({ data }) =>
    answerOf(
      await sendGesture<{ dashboard: Dashboard }>(
        getRequest(),
        `/v1/dashboards/${data.dashboardId}/versions/${data.version}/restore`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );
