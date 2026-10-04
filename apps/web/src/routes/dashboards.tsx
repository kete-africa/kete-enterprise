import { EmptyState, PageHeader, Row, RowList, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { createDashboard, fetchDashboards } from '@/lib/dashboards';
import { DialogForm, refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tableaux-de-bord')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchDashboards(),
  component: DashboardsPage,
});

/** Her dashboards (spec 033), and the ones opened to her. */
function DashboardsPage() {
  const { me } = Route.useRouteContext();
  const { dashboards } = Route.useLoaderData();
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
