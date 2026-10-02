import { PageSection, PageTitle } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchInbox } from '@/lib/decisions';
import { Circuits } from '@/lib/decisions-view';
import { administers } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/circuits')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!administers(context.me)) throw redirect({ to: '/' });
    return context;
  },
  loader: () => fetchInbox(),
  component: CircuitsPage,
});

/** The approval circuits, described as data (spec 005): part of the frame. */
function CircuitsPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  return (
    <AppShell me={me} current="circuits">
      <PageTitle>{m.nav_circuits()}</PageTitle>
      <PageSection first>
        {screen.circuits ? (
          <Circuits circuits={screen.circuits} />
        ) : (
          <p className="text-fg-muted">{m.circuits_forbidden()}</p>
        )}
      </PageSection>
    </AppShell>
  );
}
