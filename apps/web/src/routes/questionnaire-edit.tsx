import { PageHeader } from '@kete/design';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { fetchPeople } from '@/lib/admin';
import { opens } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { QuestionnaireEditor } from '@/lib/survey-editor';
import { fetchSurveys } from '@/lib/surveys';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/enquetes/questionnaires/$questionnaireId')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!opens(context.me, 'surveys', ['surveys:manage'])) throw redirect({ to: '/' });
    return context;
  },
  loader: async ({ params }) => {
    const [surveys, chart] = await Promise.all([fetchSurveys(), fetchPeople()]);
    const questionnaire =
      params.questionnaireId === 'nouveau'
        ? null
        : (surveys.questionnaires.find((q) => q.questionnaireId === params.questionnaireId) ??
          null);
    return { questionnaire, chart };
  },
  component: QuestionnairePage,
});

/**
 * A questionnaire is written on its own page (spec 019): sections, questions, the units they are
 * about — a long form, never beside the list. `nouveau` starts a new one.
 */
function QuestionnairePage() {
  const { me } = Route.useRouteContext();
  const { questionnaire, chart } = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <AppShell me={me} current="surveys">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_surveys(), href: '/enquetes' }]}
        title={questionnaire ? questionnaire.title : m.questionnaire_new()}
      />
      <div className="max-w-3xl">
        <QuestionnaireEditor
          questionnaire={questionnaire}
          chart={chart}
          onDone={() => void navigate({ to: '/enquetes' })}
        />
      </div>
    </AppShell>
  );
}
