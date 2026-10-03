import { AppCard, AppGrid, Icon, PageSection, PageHeader } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchOutbox, fetchPeople } from '@/lib/admin';
import { fetchAgents } from '@/lib/agents';
import { fetchRegistry } from '@/lib/registry';
import { fetchUsage } from '@/lib/workspace';
import { administers } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/administration')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!administers(context.me)) throw redirect({ to: '/' });
    return context;
  },
  loader: async ({ context }) => {
    // What is moving is read beside the frame; a part that fails leaves the rest of the page.
    const quiet = <T,>(read: () => Promise<T>) => read().catch(() => null);
    const [chart, outbox, registry, agents, usage] = await Promise.all([
      fetchPeople(),
      context.me.administrator ? fetchOutbox() : Promise.resolve(null),
      quiet(() => fetchRegistry()),
      context.me.modules.agents ? quiet(() => fetchAgents()) : Promise.resolve(null),
      context.me.administrator ? quiet(() => fetchUsage()) : Promise.resolve(null),
    ]);
    return {
      people: chart.people.length,
      linked: chart.people.filter((p) => p.accountUserId).length,
      units: chart.units.length,
      vacant: chart.positions.filter(
        (p) => !chart.assignments.some((a) => a.positionId === p.positionId),
      ).length,
      outbox: outbox?.messages.length ?? null,
      registry: registry && {
        resources: registry.resources.filter((r) => r.status === 'active').length,
        pending: registry.toDecide.length,
      },
      agents: agents && agents.agents.filter((a) => a.status === 'active').length,
      ai: usage && {
        model: usage.model,
        tokens: usage.purposes.reduce((sum, p) => sum + p.tokens, 0),
      },
    };
  },
  component: AdminHome,
});

/** The Administration's front page: the frame at a glance, and where to change it (spec 010). */
function AdminHome() {
  const { me } = Route.useRouteContext();
  const counts = Route.useLoaderData();
  const modulesOn = Object.values(me.modules).filter(Boolean).length;
  return (
    <AppShell me={me} current="admin">
      <PageHeader title={m.admin_title()} description={m.admin_explain()} />
      <PageSection first title={m.admin_frame()}>
        <AppGrid layout="list">
          <AppCard
            href="/administration/organisation"
            icon={<Icon name="library" />}
            name={m.nav_structure()}
            description={m.admin_units({
              units: String(counts.units),
              vacant: String(counts.vacant),
            })}
          />
          <AppCard
            href="/administration/personnes"
            icon={<Icon name="agent" />}
            name={m.nav_people()}
            description={m.admin_people({
              people: String(counts.people),
              linked: String(counts.linked),
            })}
          />
          <AppCard
            href="/administration/droits"
            icon={<Icon name="check" />}
            name={m.nav_rights()}
            description={m.admin_rights()}
          />
          {me.administrator && (
            <AppCard
              href="/administration/modules"
              icon={<Icon name="apps" />}
              name={m.nav_modules()}
              description={m.admin_modules({ on: String(modulesOn) })}
            />
          )}
          <AppCard
            href="/administration/circuits"
            icon={<Icon name="arrow" />}
            name={m.nav_circuits()}
            description={m.admin_circuits()}
          />
          <AppCard
            href="/administration/registre"
            icon={<Icon name="library" />}
            name={m.nav_registry()}
            description={
              counts.registry
                ? m.admin_registry_counts({
                    resources: String(counts.registry.resources),
                    pending: String(counts.registry.pending),
                  })
                : m.admin_registry()
            }
          />
          {counts.outbox !== null && (
            <AppCard
              href="/administration/boite-de-test"
              icon={<Icon name="download" />}
              name={m.nav_outbox()}
              description={m.admin_outbox({ count: String(counts.outbox) })}
            />
          )}
          {me.administrator && me.demo && (
            <AppCard
              href="/administration/demo"
              icon={<Icon name="learn" />}
              name={m.nav_demo()}
              description={m.admin_demo()}
            />
          )}
        </AppGrid>
      </PageSection>
      <PageSection title={m.admin_watch()}>
        <AppGrid layout="list">
          {counts.agents !== null && (
            <AppCard
              href="/administration/agents"
              icon={<Icon name="agent" />}
              name={m.nav_agents()}
              description={m.admin_agents({ active: String(counts.agents) })}
            />
          )}
          {counts.ai && (
            <AppCard
              href="/administration/ia"
              icon={<Icon name="agent" />}
              name={m.nav_ai()}
              description={
                counts.ai.model
                  ? m.admin_ai({
                      model: counts.ai.model,
                      tokens: new Intl.NumberFormat(getLocale()).format(counts.ai.tokens),
                    })
                  : m.admin_ai_none()
              }
            />
          )}
          {me.modules.compliance && (
            <AppCard
              href="/conformite"
              icon={<Icon name="check" />}
              name={m.nav_compliance()}
              description={m.admin_compliance()}
            />
          )}
        </AppGrid>
      </PageSection>
    </AppShell>
  );
}
