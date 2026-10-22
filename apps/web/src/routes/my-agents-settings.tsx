import { PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchAgents } from '@/lib/agents';
import { AgentsView } from '@/lib/agents-view';
import { fetchAgentBounds } from '@/lib/policies';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/mes-agents/reglages')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.modules.agents) throw redirect({ to: '/' });
    return context;
  },
  loader: async () => {
    const [screen, bounds] = await Promise.all([fetchAgents(), fetchAgentBounds()]);
    return { ...screen, bounds };
  },
  component: MyAgentsSettingsPage,
});

/**
 * The agents that act for the person — hers, and those of the positions she holds — in her own
 * space: an agent acts for a person, so it lives where she works (spec 016). The Administration
 * keeps the overview.
 */
function MyAgentsSettingsPage() {
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
      {/* One engine for people and agents (D-058): what her agents meet, in its sentences. */}
      <PageSection title={m.agents_bounds()}>
        {screen.bounds.length === 0 ? (
          <p className="text-fg-muted">{m.agents_bounds_none()}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
            {screen.bounds.map((policy) => (
              <li key={policy.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="font-semibold">{policy.sentence}</span>
                <Tag tone={policy.status === 'active' ? 'validated' : 'verify'}>
                  {policy.status === 'active' ? m.policy_active() : m.policy_trial()}
                </Tag>
                <span className="font-mono text-body-sm text-fg-muted">v{policy.version}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-body-sm text-fg-muted">{m.agents_bounds_same()}</p>
      </PageSection>
    </AppShell>
  );
}
