import { EmptyState, PageHeader, Row, RowList, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { createDashboard, fetchDashboards } from '@/lib/dashboards';
import { fetchFluidity } from '@/lib/for-me';
import { DialogForm, refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tableaux-de-bord')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [boards, fluidity] = await Promise.all([
      fetchDashboards(),
      // The fluidity of the holdings (spec 090): what waits, and for how long — administrators.
      fetchFluidity(),
    ]);
    return { ...boards, fluidity };
  },
  component: DashboardsPage,
});

/** Her dashboards (spec 033), and the ones opened to her. */
function DashboardsPage() {
  const { me } = Route.useRouteContext();
  const { dashboards, fluidity } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AppShell me={me} current="dashboards">
      <PageHeader
        title={m.dashboards_title()}
        description={m.dashboards_explain()}
        actions={
          <DialogForm
            title={m.dashboards_new()}
            trigger="primary"
            busy={busy}
            ready={name.trim() !== ''}
            onSubmit={() => {
              setBusy(true);
              setError(null);
              // A new dashboard starts with one card, a count, to be changed on its page.
              void createDashboard({ data: { name, widgets: [] } })
                .then(async (answer) => {
                  if (!answer.ok) return setError(refusal(answer.error));
                  setName('');
                  await router.invalidate();
                })
                .finally(() => setBusy(false));
            }}
          >
            <TextField
              label={m.dashboards_name()}
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </DialogForm>
        }
      />
      {fluidity && (
        <section
          aria-label={m.fluidity_title()}
          className="mb-6 grid gap-3 rounded-box border border-line bg-surface p-4"
        >
          <h2 className="text-body font-semibold">{m.fluidity_title()}</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                [m.fluidity_open(), String(fluidity.open)],
                [m.fluidity_waiting(), String(fluidity.waiting)],
                [m.fluidity_over48(), String(fluidity.over48h.reduce((n, w) => n + w.count, 0))],
                [
                  m.fluidity_oldest(),
                  fluidity.oldestWait
                    ? m.fluidity_hours({ count: String(fluidity.oldestWait.hours) })
                    : '—',
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-control border border-line bg-bg px-3 py-2">
                <dt className="text-body-sm text-fg-muted">{label}</dt>
                <dd className="font-mono text-[22px] font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {fluidity.oldestWait && (
            <p className="text-body-sm text-fg-muted">
              {m.fluidity_oldest_what({ what: fluidity.oldestWait.holding.what })}{' '}
              <a className="text-link underline" href={fluidity.oldestWait.holding.href}>
                {m.fluidity_open_it()}
              </a>
            </p>
          )}
          <p className="text-body-sm text-fg-muted">{m.fluidity_source()}</p>
        </section>
      )}
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      {dashboards.length === 0 ? (
        <EmptyState title={m.dashboards_none()} />
      ) : (
        <RowList label={m.dashboards_title()}>
          {dashboards.map((d) => (
            <Row
              key={d.dashboardId}
              href={`/tableaux-de-bord/${d.dashboardId}`}
              title={d.name}
              meta={d.status === 'proposed' ? m.dashboards_proposed() : (d.description ?? '')}
            />
          ))}
        </RowList>
      )}
    </AppShell>
  );
}
