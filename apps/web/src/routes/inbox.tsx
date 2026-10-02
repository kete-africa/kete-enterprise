import { AppCard, AppGrid, Icon, PageSection, PageTitle } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchInbox } from '@/lib/decisions';
import { InboxView } from '@/lib/decisions-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchMySurveys } from '@/lib/surveys';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/a-faire')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ context }) => {
    const [inbox, surveys] = await Promise.all([
      fetchInbox(),
      context.me.modules.surveys ? fetchMySurveys() : Promise.resolve({ surveys: [] }),
    ]);
    return { inbox, surveys: surveys.surveys };
  },
  component: InboxPage,
});

/**
 * Everything that waits for the person (spec 010): the forms she must fill in (spec 011), the
 * decisions she must take and her own requests (spec 005).
 */
function InboxPage() {
  const { me } = Route.useRouteContext();
  const { inbox, surveys } = Route.useLoaderData();
  const waiting = surveys.filter((s) => s.status !== 'submitted');
  return (
    <AppShell me={me} current="todo">
      <PageTitle>{m.inbox_title()}</PageTitle>
      {waiting.length > 0 && (
        <PageSection first title={m.todo_forms({ count: String(waiting.length) })}>
          <AppGrid layout="list">
            {waiting.map((s) => (
              <AppCard
                key={s.respondentId}
                href={`/enquetes/repondre/${s.respondentId}`}
                icon={<Icon name="teach" />}
                name={s.title}
                description={m.todo_form_detail({
                  period: s.period,
                  done: String(s.formsSubmitted),
                  total: String(s.formsTotal),
                  closes: s.closesOn,
                })}
              />
            ))}
          </AppGrid>
        </PageSection>
      )}
      <PageSection first={waiting.length === 0} title={m.todo_decisions()}>
        <InboxView screen={{ ...inbox, circuits: null }} />
      </PageSection>
    </AppShell>
  );
}
