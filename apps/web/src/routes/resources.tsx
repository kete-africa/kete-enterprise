import {
  Button,
  Chip,
  ChipGroup,
  CommandBar,
  CopyButton,
  DetailPane,
  Drawer,
  Facts,
  PageHeader,
  Panel,
  Row,
  RowList,
  SplitView,
  Tabs,
} from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchGateway } from '@/lib/gateway';
import { fetchRegistry, resourceKinds, type Resource, type ResourceKind } from '@/lib/registry';
import {
  kindLabel,
  RegisterForm,
  ResourceControls,
  ResourceTags,
  tierLabel,
} from '@/lib/registry-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

type Tier = 'all' | 'personal' | 'unit' | 'organization';

export const Route = createFileRoute('/ressources')({
  validateSearch: (search: Record<string, unknown>): { type?: ResourceKind } =>
    resourceKinds.includes(search['type'] as ResourceKind)
      ? { type: search['type'] as ResourceKind }
      : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [registry, gateway] = await Promise.all([fetchRegistry(), fetchGateway()]);
    return { registry, gateway };
  },
  component: ResourcesPage,
});

const tabTitle: Record<ResourceKind, () => string> = {
  app: m.resources_apps,
  skill: m.resources_skills,
  mcp: m.resources_mcp,
  agent: m.resources_agents,
};

/**
 * The person's resources (spec 014, 016): one catalogue with a tab per kind — apps, skills, MCP
 * servers, agents — filtered by tier (hers, her team's, the organization's); a resource opens in
 * the detail pane, with what to do with it; registering one opens a side panel.
 */
function ResourcesPage() {
  const { me } = Route.useRouteContext();
  const { registry, gateway } = Route.useLoaderData();
  const kind: ResourceKind = Route.useSearch().type ?? 'app';
  const [tier, setTier] = useState<Tier>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const unitName = new Map(registry.units.map((u) => [u.unitId, u.name]));
  const active = registry.resources.filter((r) => r.status === 'active');
  const shown = active
    .filter((r) => r.kind === kind)
    .filter((r) => tier === 'all' || r.tier.kind === tier);
  const resource = active.find((r) => r.resourceId === selected) ?? null;

  return (
    <AppShell me={me} current="resources">
      <PageHeader
        title={m.nav_resources()}
        description={m.resources_explain()}
        actions={<Button onClick={() => setRegistering(true)}>{m.registry_register()}</Button>}
      />
      <Tabs
        label={m.nav_resources()}
        current={kind}
        items={resourceKinds.map((k) => ({
          key: k,
          label: tabTitle[k](),
          href: `/ressources?type=${k}`,
          count: active.filter((r) => r.kind === k).length,
        }))}
      />
      <CommandBar>
        <ChipGroup label={m.resources_tier()}>
          {(
            [
              ['all', m.resources_tier_all()],
              ['personal', m.tier_personal()],
              ['unit', m.tier_team()],
              ['organization', m.tier_organization()],
            ] as [Tier, string][]
          ).map(([key, label]) => (
            <Chip key={key} pressed={tier === key} onClick={() => setTier(key)}>
              {label}
            </Chip>
          ))}
        </ChipGroup>
      </CommandBar>
      <SplitView
        detail={
          resource && (
            <ResourceDetail
              resource={resource}
              unitName={unitName}
              screen={registry}
              onClose={() => setSelected(null)}
            />
          )
        }
      >
        {shown.length === 0 ? (
          <p className="text-fg-muted">{m.resources_none()}</p>
        ) : (
          <RowList label={tabTitle[kind]()}>
            {shown.map((r) => (
              <Row
                key={r.resourceId}
                onClick={() => setSelected(r.resourceId)}
                title={r.name}
                meta={[r.description, tierLabel(r.tier, unitName), r.ownerName]
                  .filter(Boolean)
                  .join(' · ')}
                end={<ResourceTags resource={r} />}
              />
            ))}
          </RowList>
        )}
        {kind === 'mcp' && (
          <div className="mt-6">
            <Panel title={m.gateway_title()}>
              <p>{m.gateway_explain()}</p>
              <p className="mt-3 flex items-center gap-2 font-mono text-body-sm break-all">
                {gateway.address}
                <CopyButton
                  text={gateway.address}
                  label={m.common_copy()}
                  copiedLabel={m.common_copied()}
                />
              </p>
              <p className="mt-3 text-body-sm text-fg-muted">{m.gateway_how()}</p>
            </Panel>
          </div>
        )}
      </SplitView>
      <Drawer
        open={registering}
        onClose={() => setRegistering(false)}
        title={m.registry_register()}
        closeLabel={m.common_close()}
      >
        <RegisterForm onDone={() => setRegistering(false)} />
      </Drawer>
    </AppShell>
  );
}

/** A resource in the detail pane: its card, how to use it, and what its owner may do. */
function ResourceDetail({
  resource,
  unitName,
  screen,
  onClose,
}: {
  resource: Resource;
  unitName: Map<string, string>;
  screen: Parameters<typeof ResourceControls>[0]['screen'];
  onClose: () => void;
}) {
  return (
    <DetailPane
      title={resource.name}
      subtitle={kindLabel(resource.kind)}
      closeLabel={m.common_close()}
      onClose={onClose}
    >
      <div className="grid gap-4">
        {resource.description && <p>{resource.description}</p>}
        <Facts
          items={[
            { label: m.resources_owner_label(), value: resource.ownerName },
            { label: m.resources_tier(), value: tierLabel(resource.tier, unitName) },
            {
              label: m.resources_card(),
              value: (
                <span className="flex flex-wrap gap-1">
                  <ResourceTags resource={resource} />
                </span>
              ),
            },
            ...(resource.address
              ? [
                  {
                    label: m.field_address(),
                    value: (
                      <span className="flex items-center gap-1 font-mono text-body-sm break-all">
                        {resource.address}
                        <CopyButton
                          text={resource.address}
                          label={m.common_copy()}
                          copiedLabel={m.common_copied()}
                        />
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {resource.kind === 'app' && resource.address && (
          <a
            href={resource.address}
            className="inline-flex h-(--control-height) items-center justify-center rounded-control bg-action px-(--control-padding) font-semibold text-on-action hover:bg-action-strong"
          >
            {m.resources_open()}
          </a>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <ResourceControls resource={resource} screen={screen} />
        </div>
      </div>
    </DetailPane>
  );
}
