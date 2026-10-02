import { PageSection } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { SurveyAnswer } from '@/lib/survey-answer';
import { fetchMySurvey } from '@/lib/surveys';

export const Route = createFileRoute('/enquetes/repondre/$respondentId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchMySurvey({ data: { respondentId: params.respondentId } }),
  component: AnswerPage,
});

/** A person with an account answers from her space: the same forms as by link (spec 011). */
function AnswerPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  const { respondentId } = Route.useParams();
  return (
    <AppShell me={me} current="todo">
      <PageSection first>
        <SurveyAnswer screen={screen} via={`mine:${respondentId}`} />
      </PageSection>
    </AppShell>
  );
}
