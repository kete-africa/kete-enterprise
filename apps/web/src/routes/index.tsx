import {
  AppCard,
  AppGrid,
  Button,
  Icon,
  KpiGrid,
  KpiTile,
  Markdown,
  PageHeader,
  PageSection,
  Panel,
  Tag,
} from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchBriefing, refreshBriefing } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchBriefing(),
  component: Home,
});

const percent = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 1000) / 10} %`;

/**
 * Home (spec 014): the morning briefing, what waits, where she stands, her team, her apps — each
 * read from the registers with her rights. The briefing is written by the model when one is
 * configured, by rules otherwise.
 */
function Home() {
  const { me } = Route.useRouteContext();
  const briefing = Route.useLoaderData();
  const facts = briefing.facts;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overdue = facts.actions.filter((a) => a.overdue).length;
  const at = new Intl.DateTimeFormat(getLocale(), { timeStyle: 'short' }).format(
    new Date(briefing.at),
  );
  const counts = [
    { label: m.home_forms(), value: facts.forms.length, href: '/a-faire' },
    { label: m.home_decisions(), value: facts.decisions.length, href: '/a-faire' },
    {
      label: m.home_actions(),
      value: facts.actions.length,
      extra: overdue ? m.home_overdue({ count: String(overdue) }) : null,
      href: '/actions',
    },
    { label: m.home_notes(), value: facts.notes.length, href: '/a-faire' },
  ];
  return (
    <AppShell me={me} current="home">
      <PageHeader
        title={m.home_title({ name: facts.name })}
        actions={
          <a
            href="/assistant"
            className="inline-flex h-(--control-height) items-center rounded-control bg-action px-(--control-padding) font-semibold text-on-action hover:bg-action-strong"
          >
            {m.home_ask_assistant()}
          </a>
        }
      />
      <KpiGrid label={m.home_waiting()}>
        {counts.map((c) => (
          <KpiTile
            key={c.label}
            label={c.label}
            value={c.value}
            href={c.href}
            {...(c.extra ? { hint: <span className="text-state-error-fg">{c.extra}</span> } : {})}
          />
        ))}
      </KpiGrid>
      <PageSection first title={m.home_briefing()}>
        <Panel>
          <Markdown text={briefing.text} />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-body-sm text-fg-muted">
            <Tag tone={briefing.generatedBy === 'model' ? 'agent' : 'neutral'}>
              {briefing.generatedBy === 'model' ? m.home_briefing_model() : m.home_briefing_rules()}
            </Tag>
            <span>{m.home_briefing_at({ at })}</span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void refreshBriefing()
                  .then(async (answer) => {
                    if (!answer.ok) return setError(refusal(answer.error));
                    await router.invalidate();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {m.home_briefing_refresh()}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </Panel>
      </PageSection>
      {facts.performance.length > 0 && (
        <PageSection title={m.home_my_performance()}>
          <div className="grid gap-3 sm:grid-cols-2">
            {facts.performance.map((p) => (
              <Panel key={p.position} title={p.position}>
                <p className="font-number text-title font-semibold">{percent(p.factor)}</p>
                <p className="text-body-sm text-fg-muted">
                  {m.home_reds({ reds: String(p.reds.length), oranges: String(p.oranges.length) })}
                </p>
                {p.reds.length > 0 && (
                  <p className="mt-1 text-body-sm">{p.reds.slice(0, 3).join(' · ')}</p>
                )}
              </Panel>
            ))}
          </div>
        </PageSection>
      )}
      {facts.team.length > 0 && (
        <PageSection title={m.home_my_team({ count: String(facts.team.length) })}>
          <Panel>
            <ul className="grid gap-1 text-body-sm">
              {facts.team.map((p) => (
                <li key={p.name} className="flex flex-wrap justify-between gap-2">
                  <span>{p.name}</span>
                  <span className="text-fg-muted">
                    {m.home_team_line({ reds: String(p.reds), factor: percent(p.factor) })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-body-sm">
              <a className="text-link underline" href="/mon-equipe">
                {m.nav_team()}
              </a>
            </p>
          </Panel>
        </PageSection>
      )}
      {facts.appNews.length > 0 && (
        <PageSection title={m.home_app_news()}>
          <Panel>
            <ul className="grid gap-1 text-body-sm">
              {facts.appNews.map((n) => (
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
          </Panel>
        </PageSection>
      )}
      <PageSection title={m.home_my_apps()}>
        {facts.apps.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.home_no_apps()}</p>
        ) : (
          <AppGrid layout="list">
            {facts.apps.map((a) => (
              <AppCard
                key={a.name}
                {...(a.address ? { href: a.address } : {})}
                icon={<Icon name={a.kind === 'mcp' ? 'agent' : 'apps'} />}
                name={a.name}
                description={a.kind === 'mcp' ? m.home_app_mcp() : m.home_app()}
              />
            ))}
          </AppGrid>
        )}
        <p className="mt-3 text-body-sm">
          <a className="text-link underline" href="/ressources">
            {m.nav_resources()}
          </a>
        </p>
      </PageSection>
      {facts.meetings.length > 0 && (
        <PageSection title={m.home_recent_meetings()}>
          <div className="grid gap-3">
            {facts.meetings.map((mt) => (
              <Panel key={`${mt.title}-${mt.when}`} title={`${mt.title} — ${mt.when}`}>
                <ul className="list-disc pl-5 text-body-sm">
                  {mt.decisions.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </PageSection>
      )}
    </AppShell>
  );
}
