import { PageSection, PageTitle } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchInbox } from '@/lib/decisions';
import { InboxView } from '@/lib/decisions-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/a-faire')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchInbox(),
  component: InboxPage,
});

/** What waits for the person's decision, her own requests, and the circuits (spec 005). */
function InboxPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  return (
    <AppShell me={me} current="todo">
      <PageTitle>{m.inbox_title()}</PageTitle>
      <PageSection first>
        <InboxView screen={{ ...screen, circuits: null }} />
      </PageSection>
    </AppShell>
  );
}
