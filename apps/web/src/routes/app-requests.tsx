import { PageHeader, Tabs } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchAppRequests } from '@/lib/app-requests';
import { RequestRows } from '@/lib/app-requests-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

type View = 'mine' | 'to-decide' | 'all';

export const Route = createFileRoute('/ressources/demandes')({
  validateSearch: (search: Record<string, unknown>): { view?: View } =>
    search['view'] === 'to-decide' || search['view'] === 'all' ? { view: search['view'] } : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchAppRequests(),
  component: AppRequestsPage,
});

/**
 * App requests (spec 021): hers first; for IT, what waits for its decision and every request. A
 * request opens on its own page; asking for one has its page too.
 */
function AppRequestsPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  const view: View = (screen.reviews && Route.useSearch().view) || 'mine';
  const shown = view === 'to-decide' ? screen.toDecide : view === 'all' ? screen.all : screen.mine;
  return (
    <AppShell me={me} current="resources">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_resources(), href: '/ressources' }]}
        title={m.apr_title()}
        description={m.apr_explain()}
        actions={
          <a
            href="/ressources/demandes/nouvelle"
            className="inline-flex h-(--control-height) items-center rounded-control bg-action px-(--control-padding) font-semibold text-on-action hover:bg-action-strong"
          >
            {m.apr_ask()}
          </a>
        }
      />
      {screen.reviews && (
        <Tabs
          label={m.apr_title()}
          current={view}
          items={[
            {
              key: 'mine',
              label: m.apr_mine(),
              href: '/ressources/demandes',
              count: screen.mine.length,
            },
            {
              key: 'to-decide',
              label: m.apr_to_decide(),
              href: '/ressources/demandes?view=to-decide',
              count: screen.toDecide.length,
            },
            {
              key: 'all',
              label: m.apr_all(),
              href: '/ressources/demandes?view=all',
              count: screen.all.length,
            },
          ]}
        />
      )}
      {screen.reviews && !screen.factory && (
        <p role="status" className="text-body-sm text-state-verify-fg">
          {m.apr_factory_off()}
        </p>
      )}
      <RequestRows
        requests={shown}
        empty={view === 'to-decide' ? m.apr_none_to_decide() : m.apr_none()}
      />
    </AppShell>
  );
}
