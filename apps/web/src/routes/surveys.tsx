import { EmptyState, PageHeader, PageSection, Panel, Tag } from '@kete/design';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchPeople } from '@/lib/admin';
import { opens } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { campaignStatusLabel } from '@/lib/survey-results';
import { fetchSurveys } from '@/lib/surveys';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/enquetes')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!opens(context.me, 'surveys', ['surveys:manage'])) throw redirect({ to: '/' });
    return context;
  },
  loader: async () => {
    const [surveys, chart] = await Promise.all([fetchSurveys(), fetchPeople()]);
    return { ...surveys, chart };
  },
  component: SurveysPage,
});

/**
 * Surveys (spec 011), for whoever runs them (HR, QHSE): campaigns first — what goes out, what comes
 * back — then the questionnaires they use.
 */
function SurveysPage() {
  const { me } = Route.useRouteContext();
  const { questionnaires, campaigns, chart } = Route.useLoaderData();
  return (
    <AppShell me={me} current="surveys">
      <PageHeader
        title={m.nav_surveys()}
        description={m.surveys_explain()}
        actions={
          <>
            <a
              href="/enquetes/questionnaires/nouveau"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
            >
              {m.questionnaire_new()}
            </a>
            {questionnaires.length > 0 && (
              <a
                href="/enquetes/campagnes/nouvelle"
                className="inline-flex h-(--control-height) items-center rounded-control bg-action px-(--control-padding) font-semibold text-on-action hover:bg-action-strong"
              >
                {m.campaign_new()}
              </a>
            )}
          </>
        }
      />
      <PageSection first title={m.surveys_campaigns()}>
        {campaigns.length === 0 ? (
          <EmptyState title={m.surveys_no_campaign()} />
        ) : (
          <ul className="grid gap-2">
            {campaigns.map((c) => (
              <li key={c.campaignId}>
                <a
                  href={`/enquetes/${c.campaignId}`}
                  className="flex flex-wrap items-center gap-3 rounded-box border border-line bg-surface px-4 py-3 hover:border-accent"
                >
                  <span className="font-semibold">{c.title}</span>
                  <Tag>{c.period}</Tag>
                  <Tag
                    tone={
                      c.status === 'open'
                        ? 'info'
                        : c.status === 'published'
                          ? 'validated'
                          : 'neutral'
                    }
                  >
                    {campaignStatusLabel(c.status)}
                  </Tag>
                  {c.anonymous && <Tag>{m.survey_anonymous_tag()}</Tag>}
                  <span className="text-body-sm text-fg-muted">
                    {m.surveys_dates({ opens: c.opensOn, closes: c.closesOn })}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.surveys_questionnaires()}>
        <div className="grid gap-3">
          {questionnaires.map((q) => (
            <Panel key={q.questionnaireId}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <span className="font-semibold">{q.title}</span>{' '}
                  <span className="text-body-sm text-fg-muted">
                    {m.questionnaire_summary({
                      version: String(q.version),
                      sections: String(q.content.sections.length),
                      questions: String(
                        q.content.sections.reduce((n, s) => n + s.questions.length, 0),
                      ),
                    })}
                  </span>
                </span>
                <span className="flex gap-2">
                  {q.anonymous && <Tag>{m.survey_anonymous_tag()}</Tag>}
                  {q.used ? (
                    <Tag tone="neutral">{m.questionnaire_used()}</Tag>
                  ) : (
                    <a
                      href={`/enquetes/questionnaires/${q.questionnaireId}`}
                      className="text-link underline"
                    >
                      {m.questionnaire_edit()}
                    </a>
                  )}
                </span>
              </div>
            </Panel>
          ))}
        </div>
      </PageSection>
    </AppShell>
  );
}
