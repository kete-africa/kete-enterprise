import { Button, PageHeader, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { CardView } from '@/lib/dashboard-card';
import { fetchCollections } from '@/lib/collections';
import {
  dashboardGesture,
  pinDashboard,
  fetchDashboard,
  type Card,
  type Fn,
  type View,
  type Widget,
} from '@/lib/dashboards';
import { fetchDatasets } from '@/lib/datasets';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/tableaux-de-bord/$dashboardId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params, context }) => {
    const screen = await fetchDashboard({ data: { dashboardId: params.dashboardId } });
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
    return { ...screen, sources };
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

/** A dashboard (spec 033): its cards; for its owner, a new card, keeping a proposal, removing it. */
function DashboardPage() {
  const { me } = Route.useRouteContext();
  const { dashboard, manage, pinned, cards, sources } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: '',
    source: '',
    group: '',
    fn: 'count' as Fn,
    column: '',
    view: 'bar' as View,
  });
  const source = sources.find((s) => `${s.kind}:${s.id}` === draft.source);
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
  const shared = dashboard.audience.includes('everyone');
  const newCard = (): Widget | null =>
    source
      ? {
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
        }
      : null;
  return (
    <AppShell me={me} current="dashboards">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.dashboards_title(), href: '/tableaux-de-bord' }]}
        title={dashboard.name}
        {...(dashboard.description ? { description: dashboard.description } : {})}
        actions={
          <>
            {!me.viewedBy && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    pinDashboard({ data: { dashboardId: dashboard.dashboardId, pinned: !pinned } }),
                  )
                }
              >
                {pinned ? m.dashboards_unpin() : m.dashboards_pin()}
              </Button>
            )}
            {manage && (
            <>
              {dashboard.status === 'proposed' && (
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
              <DialogForm
                title={m.dashboards_card_add()}
                busy={busy}
                ready={Boolean(
                  draft.title.trim() && source && (draft.fn === 'count' || draft.column),
                )}
                onSubmit={() => {
                  const card = newCard();
                  if (card)
                    run(() =>
                      dashboardGesture({
                        data: {
                          dashboardId: dashboard.dashboardId,
                          widgets: [...dashboard.widgets, card],
                        },
                      }),
                    );
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
                  onChange={(e) =>
                    setDraft({ ...draft, source: e.target.value, group: '', column: '' })
                  }
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
            </>
            )}
          </>
        }
      />
      {dashboard.status === 'proposed' && <Tag tone="info">{m.dashboards_proposed()}</Tag>}
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card, i) => (
          <Panel key={i} title={card.title}>
            <CardView card={card} />
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
