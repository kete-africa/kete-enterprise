import { PageSection, PageTitle } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchAgents } from '@/lib/agents';
import { AgentsView } from '@/lib/agents-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/agents')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchAgents(),
  component: AgentsPage,
});

/** The agents that act for the person (all of them for a manager), and their signals (spec 007). */
function AgentsPage() {
  const screen = Route.useLoaderData();
  return (
    <AppShell current="agents">
      <PageTitle>{m.agents_title()}</PageTitle>
      <PageSection first>
        <AgentsView screen={screen} />
      </PageSection>
    </AppShell>
  );
}
