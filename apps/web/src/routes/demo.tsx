import { Button, PageSection, PageTitle, Panel, Tag } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPeople } from '@/lib/admin';
import { viewAs } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/demo')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator || !context.me.demo) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchPeople(),
  component: DemoPage,
});

/**
 * The demo (spec 010): an administrator views the space as any person who has an account, with
 * that person's rights only. The others are reached by their personal links, in the test outbox.
 */
function DemoPage() {
  const { me } = Route.useRouteContext();
  const chart = Route.useLoaderData();
  const [busy, setBusy] = useState(false);
  const titleOf = (personId: string) =>
    chart.assignments
      .filter((a) => a.personId === personId && a.kind === 'primary')
      .map((a) => chart.positions.find((p) => p.positionId === a.positionId)?.title)
      .filter(Boolean)
      .join(' · ');
  const withAccount = chart.people.filter((p) => p.accountUserId);
  const byLink = chart.people.filter((p) => !p.accountUserId);
  return (
    <AppShell me={me} current="demo">
      <PageTitle>{m.nav_demo()}</PageTitle>
      <p className="text-fg-muted">{m.demo_explain()}</p>
      <PageSection first title={m.demo_with_account({ count: String(withAccount.length) })}>
        <ul className="grid gap-2">
          {withAccount.map((person) => (
            <li
              key={person.personId}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2 last:border-0"
            >
              <span>
                <span className="font-semibold">{person.name}</span>
                <span className="block text-body-sm text-fg-muted">{titleOf(person.personId)}</span>
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void viewAs({ data: { personId: person.personId } }).then(() => {
                    window.location.href = '/';
                  });
                }}
              >
                {m.demo_view_as()}
              </Button>
            </li>
          ))}
        </ul>
      </PageSection>
      <PageSection title={m.demo_by_link({ count: String(byLink.length) })}>
        <Panel>
          <p className="mb-3 text-body-sm text-fg-muted">{m.demo_by_link_explain()}</p>
          <ul className="flex flex-wrap gap-2">
            {byLink.map((person) => (
              <li key={person.personId}>
                <Tag>{person.name}</Tag>
              </li>
            ))}
          </ul>
        </Panel>
      </PageSection>
    </AppShell>
  );
}
