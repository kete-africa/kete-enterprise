import { AppCard, AppGrid, Icon, PageHeader, PageSection } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { administers } from '@/lib/me';
import { AppShell, placesOf } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tout')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  component: Everything,
});

/**
 * « Tout » (spec 046): every place her modules and rights open, her team's apps, the
 * Administration — what the sidebar keeps out of sight to stay short.
 */
function Everything() {
  const { me } = Route.useRouteContext();
  const places = placesOf(me);
  const groups = [
    { title: m.all_space(), places: places.filter((p) => p.group === 'me') },
    { title: m.nav_tools(), places: places.filter((p) => p.group === 'tools') },
  ].filter((g) => g.places.length > 0);
  return (
    <AppShell me={me} current="all">
      <PageHeader title={m.nav_all()} description={m.all_explain()} />
      {groups.map((g, index) => (
        <PageSection key={g.title} first={index === 0} title={g.title}>
          <AppGrid layout="list" label={g.title}>
            {g.places.map((p) => (
              <AppCard key={p.page} href={p.href} icon={<Icon name={p.icon} />} name={p.label} />
            ))}
          </AppGrid>
        </PageSection>
      ))}
      {me.apps.length > 0 && (
        <PageSection title={m.nav_team_apps()}>
          <AppGrid layout="list" label={m.nav_team_apps()}>
            {me.apps.map((a) => (
              <AppCard
                key={a.resourceId}
                href={a.address}
                icon={<Icon name="apps" />}
                name={a.name}
              />
            ))}
          </AppGrid>
        </PageSection>
      )}
      {administers(me) && (
        <PageSection title={m.nav_administration()}>
          <AppGrid layout="list" label={m.nav_administration()}>
            <AppCard href="/administration" icon={<Icon name="tool" />} name={m.nav_admin_home()} />
          </AppGrid>
        </PageSection>
      )}
    </AppShell>
  );
}
