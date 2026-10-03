import { PageSection, PageHeader } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchRights } from '@/lib/rights';
import { ManageRights, MyRights } from '@/lib/rights-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/droits')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRights(),
  component: RightsPage,
});

/** What the person may do and where; for administrators, roles and their grants (spec 003). */
function RightsPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  return (
    <AppShell me={me} current="rights">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.rights_title()}
      />
      <PageSection first title={m.rights_mine()}>
        <MyRights screen={screen} />
      </PageSection>
      {screen.managed && (
        <PageSection title={m.rights_manage()}>
          <ManageRights screen={screen} />
        </PageSection>
      )}
    </AppShell>
  );
}
