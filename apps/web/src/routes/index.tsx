import { Button, Icon, Markdown, PageSection, PageTitle, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { CardView } from '@/lib/dashboard-card';
import { kindIcon, why } from '@/lib/day';
import { pinDashboard } from '@/lib/dashboards';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchToday, type DayItem } from '@/lib/today';
import { decideDraft, fetchBriefing } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [today, briefing] = await Promise.all([fetchToday(), fetchBriefing().catch(() => null)]);
    return { today, briefing };
  },
  component: Today,
});

/** How many things the day shows; the rest wait in « À faire ». */
const SHOWN = 6;

const linkButton =
  'inline-flex h-(--control-height) items-center rounded-control px-(--control-padding) font-semibold';
const secondaryLink = `${linkButton} border border-line-control text-fg hover:bg-surface-hover`;
const primaryLink = `${linkButton} bg-action text-on-action hover:bg-action-strong`;

/** One line of the day: what it is, why it is there, the gesture that settles it. */
function DayLine({ item, actions }: { item: DayItem; actions: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 max-[760px]:items-start">
      <span
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${
          item.overdue
            ? 'bg-state-error-surface text-state-error-fg'
            : 'bg-surface-selected text-fg-muted'
        }`}
      >
        <Icon name={kindIcon[item.kind]} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 basis-60 flex-col">
        <span className="font-semibold">{item.title}</span>
        <span className="text-body-sm text-fg-muted">
          {item.overdue && <span className="text-state-error-fg">{m.today_overdue()} · </span>}
          {why(item)}
        </span>
      </span>
      <span className="flex flex-wrap gap-2 max-[760px]:basis-full max-[760px]:pl-13">
        {actions}
      </span>
    </li>
  );
}

/**
 * « Aujourd'hui » (spec 046): the briefing become things to do, each with its gesture; the views
 * she pinned, up to date; what her agents did for her since yesterday. Read with her rights.
 */
function Today() {
  const { me } = Route.useRouteContext();
  const { today, briefing } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<{ ok: boolean; error: string | null }>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' }).format(new Date());
  const shown = today.day.slice(0, SHOWN);
  const more = today.day.length - shown.length;

  return (
    <AppShell me={me} current="home">
      <p className="mb-2 text-body-sm font-semibold text-fg-muted first-letter:uppercase">{date}</p>
      <PageTitle>{m.home_title({ name: today.name })}</PageTitle>
      {error && (
        <p role="alert" className="mb-4 text-state-error-fg">
          {error}
        </p>
      )}

      <PageSection first title={m.today_day()}>
        {shown.length === 0 ? (
          <p className="text-fg-muted">{m.today_nothing()}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
            {shown.map((item) => (
              <DayLine
                key={`${item.kind}-${item.id}`}
                item={item}
                actions={
                  item.kind === 'draft' && !me.viewedBy ? (
                    <>
                      <a className={secondaryLink} href={item.href}>
                        {m.today_see()}
                      </a>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(() => decideDraft({ data: { draftId: item.id, action: 'validate' } }))
                        }
                      >
                        {m.today_validate()}
                      </Button>
                    </>
                  ) : (
                    <a className={item.overdue ? primaryLink : secondaryLink} href={item.href}>
                      {item.kind === 'decision' ? m.today_decide() : m.today_open()}
                    </a>
                  )
                }
              />
            ))}
          </ul>
        )}
        {more > 0 && (
          <p className="mt-3 text-body-sm">
            <a className="text-link underline" href="/a-faire">
              {m.today_more({ count: String(more) })}
            </a>
          </p>
        )}
      </PageSection>

      {me.modules.dashboards && (
        <PageSection title={m.today_pinned()}>
          {today.pinned.length === 0 ? (
            <p className="text-fg-muted">
              {m.today_pinned_empty()}{' '}
              <a className="text-link underline" href="/tableaux-de-bord">
                {m.today_choose_view()}
              </a>
            </p>
          ) : (
            <div className="grid gap-4">
              {today.pinned.map(({ dashboard, cards }) => (
                <section
                  key={dashboard.dashboardId}
                  aria-label={dashboard.name}
                  className="rounded-box border border-line bg-surface"
                >
                  <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                    <a
                      href={`/tableaux-de-bord/${dashboard.dashboardId}`}
                      className="flex min-w-0 items-center gap-2 font-semibold text-fg"
                    >
                      <Icon name="sparkle" size={18} />
                      <span className="truncate">{dashboard.name}</span>
                    </a>
                    {!me.viewedBy && (
                      <button
                        type="button"
                        aria-label={m.dashboards_unpin()}
                        title={m.dashboards_unpin()}
                        disabled={busy}
                        className="inline-flex size-(--icon-button-size) items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover"
                        onClick={() =>
                          run(() =>
                            pinDashboard({
                              data: { dashboardId: dashboard.dashboardId, pinned: false },
                            }),
                          )
                        }
                      >
                        <Icon name="close" size={18} />
                      </button>
                    )}
                  </header>
                  <div className="grid gap-4 p-4 sm:grid-cols-2">
                    {cards.map((card, index) => (
                      <div key={index} className="min-w-0">
                        <h3 className="mb-2 text-body-sm font-semibold text-fg-muted">
                          {card.title}
                        </h3>
                        <CardView card={card} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </PageSection>
      )}

      {today.done.length > 0 && (
        <PageSection title={m.today_done()}>
          <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
            {today.done.map((t) => (
              <li key={t.taskId} className="grid gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="agent">{t.agentName}</Tag>
                  {t.status === 'failed' && <Tag tone="error">{m.today_failed()}</Tag>}
                  <span className="font-semibold">{t.instruction}</span>
                </div>
                {t.answer && <p className="text-body-sm whitespace-pre-line">{t.answer}</p>}
                {t.draftCount > 0 && (
                  <a className="text-body-sm font-semibold text-link underline" href="/a-faire">
                    {m.agent_task_drafts({ count: String(t.draftCount) })}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </PageSection>
      )}

      {briefing && (
        <PageSection title={m.home_briefing()}>
          <details className="rounded-box border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer font-semibold">{m.today_read_briefing()}</summary>
            <div className="mt-3">
              <Markdown text={briefing.text} />
            </div>
          </details>
          {briefing.facts.appNews.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 font-semibold">{m.home_app_news()}</h3>
              <ul className="grid gap-1 text-body-sm">
                {briefing.facts.appNews.map((n) => (
                  <li key={`${n.app}-${n.type}`} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="font-semibold">{n.app}</span> · {n.description}
                    </span>
                    <span className="text-fg-muted">
                      {m.home_app_news_count({ count: String(n.count) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PageSection>
      )}
    </AppShell>
  );
}
