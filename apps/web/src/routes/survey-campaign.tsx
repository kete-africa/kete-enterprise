import { Button, PageSection, PageTitle, Panel, Tag } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { opens } from '@/lib/me';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { campaignStatusLabel, SurveyResults } from '@/lib/survey-results';
import { fetchCampaign, manageSurveys, type Respondent } from '@/lib/surveys';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/enquetes/$campaignId')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!opens(context.me, 'surveys', ['surveys:manage'])) throw redirect({ to: '/' });
    return context;
  },
  loader: ({ params }) => fetchCampaign({ data: { campaignId: params.campaignId } }),
  component: CampaignPage,
});

function respondentStatus(status: Respondent['status']): string {
  return {
    pending: m.respondent_pending,
    started: m.respondent_started,
    submitted: m.respondent_submitted,
  }[status]();
}

/** One campaign: its gestures, who answered (never what, if anonymous), then its results. */
function CampaignPage() {
  const { me } = Route.useRouteContext();
  const { campaign, respondents, results } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const act = (path: string, done: (data: Record<string, unknown>) => string) => {
    setBusy(true);
    setNotice(null);
    void manageSurveys({ data: { path, body: {}, key: crypto.randomUUID() } })
      .then(async (answer) => {
        if (!answer.ok) return setNotice({ tone: 'error', text: refusal(answer.error) });
        setNotice({ tone: 'ok', text: done(answer.data ?? {}) });
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };
  const base = `/campaigns/${campaign.campaignId}`;
  const submitted = respondents.filter((r) => r.status === 'submitted').length;
  const started = respondents.filter((r) => r.status === 'started').length;
  return (
    <AppShell me={me} current="surveys">
      <PageTitle>{campaign.title}</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{campaign.period}</Tag>
        <Tag tone={campaign.status === 'open' ? 'info' : 'neutral'}>
          {campaignStatusLabel(campaign.status)}
        </Tag>
        {campaign.anonymous && <Tag>{m.survey_anonymous_tag()}</Tag>}
        <span className="text-body-sm text-fg-muted">
          {m.surveys_dates({ opens: campaign.opensOn, closes: campaign.closesOn })}
        </span>
      </div>
      <PageSection first title={m.campaign_gestures()}>
        <div className="flex flex-wrap gap-3">
          {campaign.status === 'draft' && (
            <Button
              disabled={busy}
              onClick={() =>
                act(`${base}/open`, (d) =>
                  m.campaign_opened({
                    respondents: String(d.respondents ?? 0),
                    sent: String(d.sent ?? 0),
                    relayed: String(d.relayed ?? 0),
                  }),
                )
              }
            >
              {m.campaign_open_action()}
            </Button>
          )}
          {campaign.status === 'open' && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  act(`${base}/remind`, (d) =>
                    m.campaign_reminded({ count: String(d.reminded ?? 0) }),
                  )
                }
              >
                {m.campaign_remind_action()}
              </Button>
              <Button
                disabled={busy}
                onClick={() => act(`${base}/close`, () => m.campaign_closed_done())}
              >
                {m.campaign_close_action()}
              </Button>
            </>
          )}
          {campaign.status === 'closed' && (
            <>
              <Button
                disabled={busy}
                onClick={() => act(`${base}/publish`, () => m.campaign_published_done())}
              >
                {m.campaign_publish_action()}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  act(`${base}/reopen`, (d) =>
                    m.campaign_reminded({ count: String(d.reminded ?? 0) }),
                  )
                }
              >
                {m.campaign_reopen_action()}
              </Button>
            </>
          )}
        </div>
        {notice && (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`mt-3 text-body-sm ${notice.tone === 'error' ? 'text-state-error-fg' : 'text-state-success-fg'}`}
          >
            {notice.text}
          </p>
        )}
      </PageSection>
      {campaign.status !== 'draft' && (
        <PageSection
          title={m.campaign_followup({
            submitted: String(submitted),
            started: String(started),
            total: String(respondents.length),
          })}
        >
          <Panel>
            <ul className="grid gap-1">
              {respondents.map((r) => (
                <li
                  key={r.respondentId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2 last:border-0"
                >
                  <span>
                    <span className="font-semibold">{r.name}</span>{' '}
                    <span className="text-body-sm text-fg-muted">
                      {r.email ?? m.respondent_no_email()}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Tag
                      tone={
                        r.status === 'submitted'
                          ? 'validated'
                          : r.status === 'started'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {respondentStatus(r.status)}
                    </Tag>
                    {campaign.status === 'open' && r.status !== 'submitted' && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          act(`/respondents/${r.respondentId}/resend`, () =>
                            m.respondent_resent({ name: r.name }),
                          )
                        }
                      >
                        {m.respondent_resend()}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </PageSection>
      )}
      {results && (
        <PageSection title={m.results_title()}>
          <SurveyResults results={results} campaign={campaign} />
        </PageSection>
      )}
    </AppShell>
  );
}
