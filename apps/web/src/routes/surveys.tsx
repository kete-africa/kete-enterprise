import { Button, EmptyState, PageSection, PageHeader, Panel, Tag } from '@kete/design';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPeople } from '@/lib/admin';
import { opens } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { CampaignForm, QuestionnaireEditor } from '@/lib/survey-editor';
import { campaignStatusLabel } from '@/lib/survey-results';
import { fetchSurveys, type Questionnaire } from '@/lib/surveys';
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
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Questionnaire | 'new' | null>(null);
  const [preparing, setPreparing] = useState(false);
  return (
    <AppShell me={me} current="surveys">
      <PageHeader title={m.nav_surveys()} description={m.surveys_explain()} />
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
        <div className="mt-4">
          {preparing ? (
            <CampaignForm
              questionnaires={questionnaires}
              chart={chart}
              onDone={(campaignId) => {
                setPreparing(false);
                void navigate({ to: '/enquetes/$campaignId', params: { campaignId } });
              }}
            />
          ) : (
            <Button disabled={questionnaires.length === 0} onClick={() => setPreparing(true)}>
              {m.campaign_new()}
            </Button>
          )}
        </div>
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
                    <Button variant="secondary" onClick={() => setEditing(q)}>
                      {m.questionnaire_edit()}
                    </Button>
                  )}
                </span>
              </div>
            </Panel>
          ))}
          {editing ? (
            <QuestionnaireEditor
              questionnaire={editing === 'new' ? null : editing}
              chart={chart}
              onDone={() => setEditing(null)}
            />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setEditing('new')}>
                {m.questionnaire_new()}
              </Button>
            </div>
          )}
        </div>
      </PageSection>
    </AppShell>
  );
}
