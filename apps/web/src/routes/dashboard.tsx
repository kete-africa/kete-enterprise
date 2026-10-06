import { Button, Dialog, Icon, IconButton, PageHeader, Tag, TextField } from '@kete/design';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useMemo, useState, type ReactNode } from 'react';
import ReactGridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import { askBeside, useAssistantPage } from '@/lib/chat/panel';
import { fetchCollections } from '@/lib/collections';
import { CardView } from '@/lib/dashboard-card';
import {
  boardOf,
  dashboardGesture,
  fetchDashboard,
  fetchVersions,
  forkDashboard,
  periods,
  pinDashboard,
  restoreVersion,
  type Board,
  type Card,
  type DashboardVersion,
  type DataWidget,
  type Fn,
  type View,
  type Widget,
} from '@/lib/dashboards';
import { fetchDatasets } from '@/lib/datasets';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { PinToSidebar } from '@/lib/sidebar-nav';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

type Search = { period?: string; compare?: string; filter?: string };

export const Route = createFileRoute('/tableaux-de-bord/$dashboardId')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const board = boardOf(search);
    return {
      ...(board.period !== 'all' ? { period: board.period } : {}),
      ...(board.compare ? { compare: '1' } : {}),
      ...(board.filter ? { filter: `${board.filter.column}:${board.filter.value}` } : {}),
    };
  },
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ board: boardOf(search) }),
  loader: async ({ params, context, deps }) => {
    const screen = await fetchDashboard({
      data: {
        dashboardId: params.dashboardId,
        board: {
          period: deps.board.period,
          compare: deps.board.compare ? '1' : '0',
          filter: deps.board.filter ? `${deps.board.filter.column}:${deps.board.filter.value}` : '',
        },
      },
    });
    // The sources she may compose cards from: her teams' data, the forms she runs.
    const modules = (context as { me?: { modules?: Record<string, boolean> } }).me?.modules ?? {};
    const [datasets, forms] = screen.manage
      ? await Promise.all([
          modules.datasets ? fetchDatasets().then((d) => d.datasets) : Promise.resolve([]),
          modules.forms ? fetchCollections().then((f) => f.mine) : Promise.resolve([]),
        ])
      : [[], []];
    const sources = [
      ...datasets.map((d) => ({
        kind: 'dataset' as const,
        id: d.datasetId,
        label: m.dashboards_source_dataset({ name: d.name }),
        columns: d.columns,
      })),
      ...forms.map((f) => ({
        kind: 'form' as const,
        id: f.collectionId,
        label: m.dashboards_source_form({ name: f.name }),
        columns: [
          { name: 'answered_on', type: 'date' as const },
          { name: 'status', type: 'text' as const },
          ...f.fields.map((x) => ({
            name: x.key,
            type:
              x.type === 'number' || x.type === 'yes_no' ? ('number' as const) : ('text' as const),
          })),
        ],
      })),
    ];
    return { ...screen, sources, board: deps.board };
  },
  component: DashboardPage,
});

const fnLabels: Record<Fn, () => string> = {
  count: m.dashboards_fn_count,
  sum: m.dashboards_fn_sum,
  avg: m.dashboards_fn_avg,
  min: m.dashboards_fn_min,
  max: m.dashboards_fn_max,
};
const viewLabels: Record<View, () => string> = {
  number: m.dashboards_view_number,
  bar: m.dashboards_view_bar,
  line: m.dashboards_view_line,
  pie: m.dashboards_view_pie,
  table: m.dashboards_view_table,
};
const periodLabels: Record<Board['period'], () => string> = {
  '7d': m.dashboards_period_7d,
  '30d': m.dashboards_period_30d,
  '90d': m.dashboards_period_90d,
  all: m.dashboards_period_all,
};

/** A card's first size, by what it shows: a figure is small, a chart or a table larger. */
const sizeOf = (w: Widget): { w: number; h: number } =>
  w.kind === 'note' ? { w: 4, h: 4 } : w.view === 'number' ? { w: 3, h: 3 } : { w: 6, h: 6 };

/** The grid's layout: each card's place; the cards without one below, row after row. */
function layoutOf(widgets: Widget[]): Layout {
  const placed = widgets.flatMap((w) => (w.place ? [{ i: w.id ?? '', ...w.place }] : []));
  let y = Math.max(0, ...placed.map((p) => p.y + p.h));
  let x = 0;
  let rowHeight = 0;
  const added: { i: string; x: number; y: number; w: number; h: number }[] = [];
  for (const w of widgets) {
    if (w.place) continue;
    const size = sizeOf(w);
    if (x + size.w > 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    added.push({ i: w.id ?? '', x, y, ...size });
    x += size.w;
    rowHeight = Math.max(rowHeight, size.h);
  }
  return [...placed, ...added].map((it) => ({ ...it, minW: 2, minH: 2 }));
}

/** The cards in their reading order: top to bottom, left to right — the phone's single column. */
const readingOrder = (layout: Layout) =>
  [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((it) => it.i);

/** A copy without one of its keys. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as Omit<T, K>;
}
const withoutProposal = (w: Widget): Widget => omit(w, 'proposed') as Widget;

/** A dashboard as its reader wants it (specs 033, 050). */
function DashboardPage() {
  const { me } = Route.useRouteContext();
  const { dashboard, manage, pinned, cards, sources, board } = Route.useLoaderData();
  useAssistantPage({
    kind: m.nav_dashboards(),
    title: dashboard.name,
    href: `/tableaux-de-bord/${dashboard.dashboardId}`,
  });
  const router = useRouter();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string; widgets: Widget[] } | null>(null);
  const [settings, setSettings] = useState<string | null>(null);
  const [versions, setVersions] = useState<DashboardVersion[] | null>(null);
  const run = (work: () => Promise<{ ok: boolean; error: string | null }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        after?.();
        await router.invalidate();
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };
  const save = (widgets: Widget[], name?: string) =>
    run(
      () =>
        dashboardGesture({
          data: { dashboardId: dashboard.dashboardId, widgets, ...(name ? { name } : {}) },
        }),
      () => setEditing(null),
    );
  const setBoard = (next: Partial<Board>) => {
    const b = { ...board, ...next };
    void navigate({
      to: '/tableaux-de-bord/$dashboardId',
      params: { dashboardId: dashboard.dashboardId },
      search: {
        ...(b.period !== 'all' ? { period: b.period } : {}),
        ...(b.compare ? { compare: '1' } : {}),
        ...(b.filter ? { filter: `${b.filter.column}:${b.filter.value}` } : {}),
      },
    });
  };
  const widgets = editing?.widgets ?? dashboard.widgets;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const shared = dashboard.audience.includes('everyone');
  const proposedCards = dashboard.widgets.filter((w) => w.proposed);
  const settled = (w: Widget): Card | null => {
    const card = byId.get(w.id ?? '');
    if (w.kind === 'note') {
      return {
        kind: 'note',
        id: w.id ?? '',
        title: w.title,
        text: w.text,
        place: w.place ?? null,
        proposed: w.proposed === true,
      };
    }
    return card ?? null;
  };
  const updateWidget = (id: string, change: (w: Widget) => Widget) =>
    setEditing((e) =>
      e ? { ...e, widgets: e.widgets.map((w) => ((w.id ?? '') === id ? change(w) : w)) } : e,
    );
  const settingsOf = editing?.widgets.find((w) => w.id === settings) ?? null;

  return (
    <AppShell me={me} current="dashboards">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.dashboards_title(), href: '/tableaux-de-bord' }]}
        title={dashboard.name}
        {...(dashboard.description ? { description: dashboard.description } : {})}
        actions={
          editing ? null : (
            <>
              {manage && (
                <Button
                  variant="secondary"
                  onClick={() => setEditing({ name: dashboard.name, widgets: dashboard.widgets })}
                >
                  {m.dashboards_edit()}
                </Button>
              )}
              {manage && (
                <Button
                  variant="secondary"
                  onClick={() => askBeside(m.dashboards_build_question())}
                >
                  <Icon name="sparkle" />
                  {m.dashboards_build()}
                </Button>
              )}
              {!manage && !me.viewedBy && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void forkDashboard({ data: { dashboardId: dashboard.dashboardId } })
                      .then((answer) => {
                        if (!answer.ok || !answer.data) return setError(refusal(answer.error));
                        void navigate({
                          to: '/tableaux-de-bord/$dashboardId',
                          params: { dashboardId: answer.data.dashboard.dashboardId },
                        });
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  {m.dashboards_fork()}
                </Button>
              )}
              {!me.viewedBy && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      pinDashboard({
                        data: { dashboardId: dashboard.dashboardId, pinned: !pinned },
                      }),
                    )
                  }
                >
                  {pinned ? m.dashboards_unpin() : m.dashboards_pin()}
                </Button>
              )}
              <PinToSidebar
                me={me}
                shortcut={{ kind: 'dashboard', ref: dashboard.dashboardId, label: dashboard.name }}
              />
              {manage && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void fetchVersions({ data: { dashboardId: dashboard.dashboardId } }).then((v) =>
                      setVersions(v.versions),
                    )
                  }
                >
                  {m.dashboards_versions()}
                </Button>
              )}
              {manage && dashboard.status === 'proposed' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      dashboardGesture({
                        data: { dashboardId: dashboard.dashboardId, keep: true },
                      }),
                    )
                  }
                >
                  {m.dashboards_keep()}
                </Button>
              )}
              {manage && me.administrator && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      dashboardGesture({
                        data: {
                          dashboardId: dashboard.dashboardId,
                          audience: shared ? `user:${dashboard.ownerId}` : 'everyone',
                        },
                      }),
                    )
                  }
                >
                  {shared ? m.dashboards_keep_owner() : m.dashboards_open_everyone()}
                </Button>
              )}
              {manage && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        dashboardGesture({
                          data: { dashboardId: dashboard.dashboardId, remove: true },
                        }),
                      () => void router.navigate({ to: '/tableaux-de-bord' }),
                    )
                  }
                >
                  {m.dashboards_remove()}
                </Button>
              )}
            </>
          )
        }
      />
      {dashboard.status === 'proposed' && <Tag tone="info">{m.dashboards_proposed()}</Tag>}
      {!manage && !me.viewedBy && <Banner>{m.dashboards_fork_banner()}</Banner>}
      {manage && dashboard.forkedFrom && <Banner>{m.dashboards_forked()}</Banner>}
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      {editing ? (
        <EditBar
          name={editing.name}
          onName={(name) => setEditing({ ...editing, name })}
          busy={busy}
          sources={sources}
          onAdd={(w) => setEditing({ ...editing, widgets: [...editing.widgets, w] })}
          onDone={() =>
            save(
              editing.widgets,
              editing.name.trim() && editing.name !== dashboard.name ? editing.name : undefined,
            )
          }
          onCancel={() => setEditing(null)}
        />
      ) : (
        <BoardBar board={board} onChange={setBoard} />
      )}
      {!editing && manage && proposedCards.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-box border border-dashed border-accent px-4 py-3 text-body-sm">
          <Icon name="sparkle" />
          <span className="flex-1">{m.dashboards_proposed_card()}</span>
          <Button disabled={busy} onClick={() => save(dashboard.widgets.map(withoutProposal))}>
            {m.dashboards_keep()}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => save(dashboard.widgets.filter((w) => !w.proposed))}
          >
            {m.dashboards_drop_card()}
          </Button>
        </div>
      )}
      {widgets.length === 0 ? (
        <p className="text-body text-fg-muted">{m.dashboards_no_cards()}</p>
      ) : (
        <Grid
          widgets={widgets}
          editing={Boolean(editing)}
          onLayout={(layout) =>
            setEditing((e) =>
              e
                ? {
                    ...e,
                    widgets: e.widgets.map((w) => {
                      const it = layout.find((l) => l.i === w.id);
                      return it ? { ...w, place: { x: it.x, y: it.y, w: it.w, h: it.h } } : w;
                    }),
                  }
                : e,
            )
          }
          render={(w) => {
            const card = settled(w);
            return (
              <CardFrame
                title={w.title}
                proposed={w.proposed === true}
                editing={Boolean(editing)}
                manage={manage}
                busy={busy}
                onSettings={() => setSettings(w.id ?? '')}
                onRemoveCard={() =>
                  setEditing((e) =>
                    e ? { ...e, widgets: e.widgets.filter((x) => x.id !== w.id) } : e,
                  )
                }
                onKeep={() =>
                  save(dashboard.widgets.map((x) => (x.id === w.id ? withoutProposal(x) : x)))
                }
                onDrop={() => save(dashboard.widgets.filter((x) => x.id !== w.id))}
              >
                {card ? (
                  <CardView
                    card={card}
                    selected={board.filter?.value ?? null}
                    onSelect={(column, value) =>
                      setBoard({
                        filter:
                          board.filter?.column === column && board.filter.value === value
                            ? null
                            : { column, value },
                      })
                    }
                  />
                ) : (
                  <p className="text-body-sm text-fg-muted">{m.dashboards_empty_card()}</p>
                )}
              </CardFrame>
            );
          }}
        />
      )}
      {settingsOf && (
        <CardSettings
          widget={settingsOf}
          onChange={(change) => updateWidget(settingsOf.id ?? '', change)}
          onClose={() => setSettings(null)}
        />
      )}
      <Dialog
        open={versions !== null}
        onClose={() => setVersions(null)}
        closeLabel={m.common_close()}
        title={m.dashboards_versions()}
      >
        <div className="grid gap-3">
          <p className="text-body-sm text-fg-muted">{m.dashboards_versions_explain()}</p>
          {versions?.length === 0 && (
            <p className="text-body-sm text-fg-muted">{m.dashboards_versions_none()}</p>
          )}
          <ul className="grid gap-2">
            {versions?.map((v) => (
              <li key={v.version} className="flex items-center gap-3 border-t border-line pt-2">
                <span className="grid flex-1">
                  <span className="font-semibold">
                    {m.dashboards_version_item({ name: v.name, count: String(v.cardCount) })}
                  </span>
                  <span className="text-body-sm text-fg-muted">
                    {new Date(v.savedAt).toLocaleString()}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        restoreVersion({
                          data: { dashboardId: dashboard.dashboardId, version: v.version },
                        }),
                      () => setVersions(null),
                    )
                  }
                >
                  {m.dashboards_restore()}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </AppShell>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-box border border-line bg-surface-muted px-4 py-3 text-body-sm text-fg-muted">
      {children}
    </p>
  );
}

/** Her board: a period, the period before, the filter a click set. */
function BoardBar({ board, onChange }: { board: Board; onChange: (b: Partial<Board>) => void }) {
  const seg = (on: boolean) =>
    `rounded-control px-3 py-1 text-body-sm ${on ? 'bg-surface-selected font-semibold text-fg' : 'text-fg-muted hover:text-fg'}`;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div
        role="group"
        aria-label={m.dashboards_period()}
        className="inline-flex gap-0.5 rounded-control border border-line p-0.5"
      >
        {periods.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={board.period === p}
            className={seg(board.period === p)}
            onClick={() => onChange({ period: p, ...(p === 'all' ? { compare: false } : {}) })}
          >
            {periodLabels[p]()}
          </button>
        ))}
      </div>
      <label
        className={`flex items-center gap-2 text-body-sm ${board.period === 'all' ? 'opacity-50' : ''}`}
      >
        <input
          type="checkbox"
          checked={board.compare}
          disabled={board.period === 'all'}
          onChange={(e) => onChange({ compare: e.target.checked })}
        />
        {m.dashboards_compare()}
      </label>
      {board.filter ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-focus py-0.5 pr-1 pl-3 text-body-sm">
          {m.dashboards_filtered_on({ column: board.filter.column, value: board.filter.value })}
          <IconButton
            label={m.dashboards_clear_filter()}
            onClick={() => onChange({ filter: null })}
          >
            <Icon name="close" />
          </IconButton>
        </span>
      ) : (
        <span className="text-body-sm text-fg-muted">{m.dashboards_click_filters()}</span>
      )}
    </div>
  );
}

/** The grid of cards: arranged by its owner in « Modifier », read in order on a phone. */
function Grid({
  widgets,
  editing,
  onLayout,
  render,
}: {
  widgets: Widget[];
  editing: boolean;
  onLayout: (layout: Layout) => void;
  render: (w: Widget) => ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const layout = useMemo(() => layoutOf(widgets), [widgets]);
  const narrow = mounted && width < 640;
  return (
    <div ref={containerRef}>
      {narrow ? (
        <div className="grid gap-4">
          {readingOrder(layout).map((id) => {
            const w = widgets.find((x) => x.id === id);
            return w ? (
              <div key={id} className="min-h-40">
                {render(w)}
              </div>
            ) : null;
          })}
        </div>
      ) : (
        mounted && (
          <ReactGridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: 12, rowHeight: 36, margin: [16, 16], containerPadding: [0, 0] }}
            dragConfig={{ enabled: editing, handle: '.kete-card-handle' }}
            resizeConfig={{ enabled: editing }}
            {...(editing ? { onLayoutChange: onLayout } : {})}
          >
            {widgets.map((w) => (
              <div key={w.id ?? ''}>{render(w)}</div>
            ))}
          </ReactGridLayout>
        )
      )}
    </div>
  );
}

function CardFrame({
  title,
  proposed,
  editing,
  manage,
  busy,
  onSettings,
  onRemoveCard,
  onKeep,
  onDrop,
  children,
}: {
  title: string;
  proposed: boolean;
  editing: boolean;
  manage: boolean;
  busy: boolean;
  onSettings: () => void;
  onRemoveCard: () => void;
  onKeep: () => void;
  onDrop: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex h-full flex-col gap-3 overflow-hidden rounded-box border bg-surface p-4 text-fg ${
        proposed
          ? 'border-dashed border-accent'
          : editing
            ? 'border-dashed border-line'
            : 'border-line'
      }`}
    >
      <header className="flex items-center gap-1">
        {editing && (
          <span
            className="kete-card-handle inline-flex cursor-grab text-fg-muted"
            role="img"
            aria-label={m.dashboards_drag({ title })}
          >
            <Icon name="menu" />
          </span>
        )}
        <h2 className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg-muted">
          {title}
        </h2>
        {editing && (
          <>
            <IconButton label={m.dashboards_card_settings({ title })} onClick={onSettings}>
              <Icon name="tool" />
            </IconButton>
            <IconButton label={m.dashboards_remove_card()} onClick={onRemoveCard}>
              <Icon name="close" />
            </IconButton>
          </>
        )}
        {!editing && proposed && manage && (
          <>
            <span className="text-body-sm font-semibold text-accent">
              {m.dashboards_proposed_card()}
            </span>
            <Button disabled={busy} onClick={onKeep}>
              {m.dashboards_keep_card()}
            </Button>
            <IconButton label={m.dashboards_drop_card()} onClick={onDrop}>
              <Icon name="close" />
            </IconButton>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

type Source = {
  kind: 'dataset' | 'form';
  id: string;
  label: string;
  columns: { name: string; type: string }[];
};

/** « Modifier »: the name, a new card or note, « Terminé » or « Annuler ». */
function EditBar({
  name,
  onName,
  busy,
  sources,
  onAdd,
  onDone,
  onCancel,
}: {
  name: string;
  onName: (name: string) => void;
  busy: boolean;
  sources: Source[];
  onAdd: (w: Widget) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: '',
    source: '',
    group: '',
    fn: 'count' as Fn,
    column: '',
    view: 'bar' as View,
  });
  const [note, setNote] = useState({ title: '', text: '' });
  const source = sources.find((s) => `${s.kind}:${s.id}` === draft.source);
  return (
    <div className="sticky top-0 z-10 grid gap-3 rounded-menu border border-focus bg-surface p-4">
      <p className="text-body-sm text-fg-muted">{m.dashboards_editing()}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <TextField
            label={m.dashboards_rename()}
            value={name}
            maxLength={160}
            onChange={(e) => onName(e.target.value)}
          />
        </div>
        <DialogForm
          title={m.dashboards_card_add()}
          busy={busy}
          ready={Boolean(draft.title.trim() && source && (draft.fn === 'count' || draft.column))}
          onSubmit={() => {
            if (!source) return;
            const card: DataWidget = {
              title: draft.title,
              source: { kind: source.kind, id: source.id },
              query: {
                ...(draft.group ? { groupBy: [draft.group] } : {}),
                measures: [
                  {
                    fn: draft.fn,
                    ...(draft.fn !== 'count' && draft.column ? { column: draft.column } : {}),
                  },
                ],
              },
              view: draft.view,
            };
            onAdd({ ...card, id: `w${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}` });
            setDraft({ ...draft, title: '' });
          }}
        >
          <TextField
            label={m.dashboards_card_title()}
            value={draft.title}
            maxLength={160}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <Select
            label={m.dashboards_card_source()}
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value, group: '', column: '' })}
          >
            <option value="" />
            {sources.map((s) => (
              <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select
            label={m.dashboards_card_group()}
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          >
            <option value="">{m.dashboards_card_group_none()}</option>
            {(source?.columns ?? [])
              .filter((c) => c.type !== 'number')
              .map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
          </Select>
          <Select
            label={m.dashboards_card_measure()}
            value={draft.fn}
            onChange={(e) => setDraft({ ...draft, fn: e.target.value as Fn })}
          >
            {(Object.keys(fnLabels) as Fn[]).map((fn) => (
              <option key={fn} value={fn}>
                {fnLabels[fn]()}
              </option>
            ))}
          </Select>
          {draft.fn !== 'count' && (
            <Select
              label={m.dashboards_card_column()}
              value={draft.column}
              onChange={(e) => setDraft({ ...draft, column: e.target.value })}
            >
              <option value="" />
              {(source?.columns ?? [])
                .filter((c) => c.type === 'number')
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
            </Select>
          )}
          <Select
            label={m.dashboards_card_view()}
            value={draft.view}
            onChange={(e) => setDraft({ ...draft, view: e.target.value as View })}
          >
            {(Object.keys(viewLabels) as View[]).map((view) => (
              <option key={view} value={view}>
                {viewLabels[view]()}
              </option>
            ))}
          </Select>
        </DialogForm>
        <DialogForm
          title={m.dashboards_add_note()}
          busy={busy}
          ready={Boolean(note.title.trim())}
          onSubmit={() => {
            onAdd({
              kind: 'note',
              id: `w${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
              title: note.title,
              text: note.text,
            });
            setNote({ title: '', text: '' });
          }}
        >
          <TextField
            label={m.dashboards_note_title()}
            value={note.title}
            maxLength={160}
            onChange={(e) => setNote({ ...note, title: e.target.value })}
          />
          <NoteText value={note.text} onChange={(text) => setNote({ ...note, text })} />
        </DialogForm>
        <Button disabled={busy} onClick={onDone}>
          {m.dashboards_done()}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {m.dashboards_cancel()}
        </Button>
      </div>
    </div>
  );
}

function NoteText({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
      {m.dashboards_note_text()}
      <textarea
        value={value}
        maxLength={4000}
        rows={6}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal"
      />
    </label>
  );
}

const numberOf = (text: string) => {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/** A card's settings, applied at once while she edits: its title, view, goal and threshold. */
function CardSettings({
  widget,
  onChange,
  onClose,
}: {
  widget: Widget;
  onChange: (change: (w: Widget) => Widget) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={m.common_close()}
      title={m.dashboards_card_settings({ title: widget.title })}
    >
      <div className="grid gap-4">
        <TextField
          label={m.dashboards_card_title()}
          value={widget.title}
          maxLength={160}
          onChange={(e) => {
            const title = e.target.value;
            onChange((w) => ({ ...w, title }));
          }}
        />
        {widget.kind === 'note' ? (
          <NoteText
            value={widget.text}
            onChange={(text) => onChange((w) => (w.kind === 'note' ? { ...w, text } : w))}
          />
        ) : (
          <DataSettings widget={widget} onChange={onChange} />
        )}
        <Button onClick={onClose}>{m.dashboards_done()}</Button>
      </div>
    </Dialog>
  );
}

function DataSettings({
  widget,
  onChange,
}: {
  widget: DataWidget;
  onChange: (change: (w: Widget) => Widget) => void;
}) {
  const data = (change: (w: DataWidget) => DataWidget) =>
    onChange((w) => (w.kind === 'note' ? w : change(w)));
  return (
    <>
      <Select
        label={m.dashboards_card_view()}
        value={widget.view}
        onChange={(e) => {
          const view = e.target.value as View;
          data((w) => ({ ...w, view }));
        }}
      >
        {(Object.keys(viewLabels) as View[]).map((view) => (
          <option key={view} value={view}>
            {viewLabels[view]()}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={m.dashboards_goal()}
          inputMode="decimal"
          placeholder={m.dashboards_goal_none()}
          defaultValue={widget.goal ? String(widget.goal.value) : ''}
          onChange={(e) => {
            const value = numberOf(e.target.value);
            data((w) => {
              const rest = omit(w, 'goal');
              return value === undefined
                ? rest
                : { ...rest, goal: { value, better: w.goal?.better ?? 'up' } };
            });
          }}
        />
        <Select
          label={m.dashboards_better()}
          value={widget.goal?.better ?? 'up'}
          disabled={!widget.goal}
          onChange={(e) => {
            const better = e.target.value === 'down' ? 'down' : 'up';
            data((w) => (w.goal ? { ...w, goal: { ...w.goal, better } } : w));
          }}
        >
          <option value="up">{m.dashboards_better_up()}</option>
          <option value="down">{m.dashboards_better_down()}</option>
        </Select>
      </div>
      <TextField
        label={m.dashboards_threshold()}
        inputMode="decimal"
        placeholder={m.dashboards_goal_none()}
        defaultValue={widget.threshold !== undefined ? String(widget.threshold) : ''}
        onChange={(e) => {
          const threshold = numberOf(e.target.value);
          data((w) => {
            const rest = omit(w, 'threshold');
            return threshold === undefined ? rest : { ...rest, threshold };
          });
        }}
      />
    </>
  );
}
