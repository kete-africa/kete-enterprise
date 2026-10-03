import { EmptyState, PageSection, PageHeader } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchMyPerformance } from '@/lib/performance';
import { ReviewCards } from '@/lib/review-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/mon-equipe')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ context }) =>
    context.me.modules.performance
      ? fetchMyPerformance()
      : Promise.resolve({ reviews: [], team: [] }),
  component: TeamPage,
});

/** The manager's people (spec 012): the reviews she conducts, found in the structure. */
function TeamPage() {
  const { me } = Route.useRouteContext();
  const { team } = Route.useLoaderData();
  const toWrite = team.filter((r) => r.status === 'measured');
  return (
    <AppShell me={me} current="team">
      <PageHeader title={m.nav_team()} description={m.team_explain()} />
      <PageSection first title={m.team_to_write({ count: String(toWrite.length) })}>
        {toWrite.length === 0 ? (
          <EmptyState title={m.team_nothing()} />
        ) : (
          <ReviewCards reviews={toWrite} />
        )}
      </PageSection>
      <PageSection title={m.team_all({ count: String(team.length) })}>
        <ReviewCards reviews={team} />
      </PageSection>
    </AppShell>
  );
}
