import { PageHeader } from '@kete/design';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { fetchPeople } from '@/lib/admin';
import { opens } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { CampaignForm } from '@/lib/survey-editor';
import { fetchSurveys } from '@/lib/surveys';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/enquetes/campagnes/nouvelle')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!opens(context.me, 'surveys', ['surveys:manage'])) throw redirect({ to: '/' });
    return context;
  },
  loader: async () => {
    const [surveys, chart] = await Promise.all([fetchSurveys(), fetchPeople()]);
    return { questionnaires: surveys.questionnaires, chart };
  },
  component: NewCampaignPage,
});

/** A campaign is prepared on its own page (spec 019): never beside the list of campaigns. */
function NewCampaignPage() {
  const { me } = Route.useRouteContext();
  const { questionnaires, chart } = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <AppShell me={me} current="surveys">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_surveys(), href: '/enquetes' }]}
        title={m.campaign_new()}
      />
      <div className="max-w-3xl">
        <CampaignForm
          questionnaires={questionnaires}
          chart={chart}
          onDone={(campaignId) =>
            void navigate({ to: '/enquetes/$campaignId', params: { campaignId } })
          }
        />
      </div>
    </AppShell>
  );
}
