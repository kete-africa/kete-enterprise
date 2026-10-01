import { PageSection, PageTitle } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  component: Home,
});

/** Home: who is signed in, and in which organization (spec 001). */
function Home() {
  const { me } = Route.useRouteContext();
  return (
    <AppShell current="home">
      <PageTitle>{m.home_title({ name: me.name })}</PageTitle>
      <PageSection first title={m.home_organization()}>
        <p className="text-fg-muted">{m.home_organization_id({ id: me.organizationId })}</p>
      </PageSection>
    </AppShell>
  );
}
