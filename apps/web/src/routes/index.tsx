import { PageSection, PageTitle, Panel } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchGateway } from '@/lib/gateway';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchGateway(),
  component: Home,
});

/** Home: who is signed in, her organization, and her copilot's gateway (specs 001, 006). */
function Home() {
  const { me } = Route.useRouteContext();
  const gateway = Route.useLoaderData();
  const format = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' });
  return (
    <AppShell current="home">
      <PageTitle>{m.home_title({ name: me.name })}</PageTitle>
      <PageSection first title={m.home_organization()}>
        <p className="text-fg-muted">{m.home_organization_id({ id: me.organizationId })}</p>
      </PageSection>
      <PageSection title={m.gateway_title()}>
        <Panel>
          <p>{m.gateway_explain()}</p>
          <p className="mt-3 font-mono text-body-sm break-all">{gateway.address}</p>
          <p className="mt-3 text-body-sm text-fg-muted">{m.gateway_how()}</p>
        </Panel>
        <div className="mt-6">
          <Panel title={m.gateway_calls()}>
            {gateway.calls.length === 0 ? (
              <p className="text-fg-muted">{m.gateway_no_calls()}</p>
            ) : (
              <ul className="grid gap-1 text-body-sm">
                {gateway.calls.map((call) => (
                  <li key={call.callId} className="flex flex-wrap gap-2">
                    <span className="font-number text-fg-muted">
                      {format.format(new Date(call.createdAt))}
                    </span>
                    <span className="font-mono">{call.tool}</span>
                    {call.client && <span className="text-fg-muted">{call.client}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PageSection>
    </AppShell>
  );
}
