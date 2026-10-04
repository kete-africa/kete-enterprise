import { Button, PageSection, PageHeader, Panel, Tag } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { administer, fetchOrganization } from '@/lib/admin';
import { refusal } from '@/lib/forms';
import type { ModuleKey } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/modules')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchOrganization(),
  component: ModulesPage,
});

const modules: { key: ModuleKey; name: () => string; explain: () => string }[] = [
  { key: 'surveys', name: m.nav_surveys, explain: m.module_surveys },
  { key: 'performance', name: m.nav_performance, explain: m.module_performance },
  { key: 'meetings', name: m.nav_meetings, explain: m.module_meetings },
  { key: 'compliance', name: m.nav_compliance, explain: m.module_compliance },
  { key: 'agents', name: m.nav_agents, explain: m.module_agents },
  { key: 'knowledge', name: m.nav_library, explain: m.module_knowledge },
  { key: 'dossiers', name: m.nav_dossiers, explain: m.module_dossiers },
];

/** Which business tools the organization uses (spec 010): switched off, the data stays. */
function ModulesPage() {
  const { me } = Route.useRouteContext();
  const organization = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const toggle = (module: ModuleKey, enabled: boolean) => {
    setError(null);
    void administer({
      data: { path: '/organization/modules', body: { module, enabled }, key: crypto.randomUUID() },
    }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      // The menus follow the modules: reload the whole page.
      window.location.reload();
      await router.invalidate();
    });
  };
  return (
    <AppShell me={me} current="modules">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_modules()}
        description={m.modules_explain()}
      />
      <PageSection first>
        <div className="grid gap-4">
          {modules.map((module) => {
            const on = organization.modules[module.key];
            return (
              <Panel key={module.key} title={module.name()}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="max-w-2xl text-body-sm text-fg-muted">{module.explain()}</p>
                  <div className="flex items-center gap-3">
                    <Tag tone={on ? 'validated' : 'neutral'}>
                      {on ? m.module_on() : m.module_off()}
                    </Tag>
                    <Button
                      variant={on ? 'secondary' : 'primary'}
                      onClick={() => toggle(module.key, !on)}
                    >
                      {on ? m.module_switch_off() : m.module_switch_on()}
                    </Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
      </PageSection>
    </AppShell>
  );
}
