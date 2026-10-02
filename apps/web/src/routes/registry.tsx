import { PageSection, PageTitle } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchRegistry } from '@/lib/registry';
import { RegistryView } from '@/lib/registry-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/registre')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchRegistry(),
  component: RegistryPage,
});

/** The company's apps, skills, MCP servers and agents, as the person may see them (spec 004). */
function RegistryPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  return (
    <AppShell me={me} current="registry">
      <PageTitle>{m.registry_title()}</PageTitle>
      <PageSection first>
        <RegistryView screen={screen} />
      </PageSection>
    </AppShell>
  );
}
