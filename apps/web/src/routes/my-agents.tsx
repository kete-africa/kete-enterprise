import { PageHeader } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchAgents } from '@/lib/agents';
import { AgentsView } from '@/lib/agents-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/mes-agents')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.modules.agents) throw redirect({ to: '/' });
    return context;
  },
  loader: () => fetchAgents(),
  component: MyAgentsPage,
});

/**
 * The agents that act for the person — hers, and those of the positions she holds — in her own
 * space: an agent acts for a person, so it lives where she works (spec 016). The Administration
 * keeps the overview.
 */
function MyAgentsPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  const myPositions = new Set(
    screen.chart.assignments.filter((a) => a.personId === me.personId).map((a) => a.positionId),
  );
  const mine = screen.agents.filter(
    (agent) =>
      agent.actsFor === screen.me ||
      (agent.positionId !== null && myPositions.has(agent.positionId)),
  );
  return (
    <AppShell me={me} current="my_agents">
      <PageHeader title={m.nav_my_agents()} description={m.my_agents_explain()} />
      <AgentsView screen={{ ...screen, agents: mine }} />
    </AppShell>
  );
}
