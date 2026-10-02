import { AppCard, AppGrid, Icon, PageSection, PageTitle } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchOutbox, fetchPeople } from '@/lib/admin';
import { administers } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!administers(context.me)) throw redirect({ to: '/' });
    return context;
  },
  loader: async ({ context }) => {
    const [chart, outbox] = await Promise.all([
      fetchPeople(),
      context.me.administrator ? fetchOutbox() : Promise.resolve(null),
    ]);
    return {
      people: chart.people.length,
      linked: chart.people.filter((p) => p.accountUserId).length,
      units: chart.units.length,
      vacant: chart.positions.filter(
        (p) => !chart.assignments.some((a) => a.positionId === p.positionId),
      ).length,
      outbox: outbox?.messages.length ?? null,
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
      <PageTitle>{m.admin_title()}</PageTitle>
      <p className="text-fg-muted">{m.admin_explain()}</p>
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
            description={m.admin_registry()}
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
    </AppShell>
  );
}
