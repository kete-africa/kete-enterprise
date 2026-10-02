import {
  AppCard,
  AppGrid,
  Icon,
  PageSection,
  PageTitle,
  Panel,
  Tag,
  type IconName,
} from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchGateway } from '@/lib/gateway';
import { fetchRegistry, type Resource, type ResourceKind } from '@/lib/registry';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ressources')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [registry, gateway] = await Promise.all([fetchRegistry(), fetchGateway()]);
    return { registry, gateway };
  },
  component: ResourcesPage,
});

const sections: { kind: ResourceKind; title: () => string; icon: IconName }[] = [
  { kind: 'app', title: m.resources_apps, icon: 'apps' },
  { kind: 'skill', title: m.resources_skills, icon: 'teach' },
  { kind: 'mcp', title: m.resources_mcp, icon: 'agent' },
  { kind: 'agent', title: m.resources_agents, icon: 'learn' },
];

function tierLabel(resource: Resource): string {
  return resource.tier.kind === 'personal'
    ? m.tier_personal()
    : resource.tier.kind === 'unit'
      ? m.tier_team()
      : m.tier_organization();
}

/**
 * The person's resources (spec 014): the apps, skills, MCP servers and agents her tier and units
 * give her — her own, her team's, the organization's — and her copilot's address.
 */
function ResourcesPage() {
  const { me } = Route.useRouteContext();
  const { registry, gateway } = Route.useLoaderData();
  const active = registry.resources.filter((r) => r.status === 'active');
  return (
    <AppShell me={me} current="resources">
      <PageTitle>{m.nav_resources()}</PageTitle>
      <p className="text-fg-muted">{m.resources_explain()}</p>
      {sections.map((section, i) => {
        const items = active.filter((r) => r.kind === section.kind);
        if (items.length === 0) return null;
        return (
          <PageSection key={section.kind} first={i === 0} title={section.title()}>
            <AppGrid layout="list">
              {items.map((r) => (
                <AppCard
                  key={r.resourceId}
                  {...(r.address && r.kind === 'app' ? { href: r.address } : {})}
                  icon={<Icon name={section.icon} />}
                  name={r.name}
                  description={
                    <span className="flex flex-col gap-1">
                      <span>{r.description ?? ''}</span>
                      <span className="flex flex-wrap gap-1">
                        <Tag>{tierLabel(r)}</Tag>
                        <Tag>{m.resources_owner({ name: r.ownerName })}</Tag>
                      </span>
                    </span>
                  }
                />
              ))}
            </AppGrid>
          </PageSection>
        );
      })}
      <PageSection title={m.gateway_title()}>
        <Panel>
          <p>{m.gateway_explain()}</p>
          <p className="mt-3 font-mono text-body-sm break-all">{gateway.address}</p>
          <p className="mt-3 text-body-sm text-fg-muted">{m.gateway_how()}</p>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
