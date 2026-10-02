import { Button, EmptyState, PageSection, PageTitle, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { opens } from '@/lib/me';
import { fetchQuarters, percent, performanceGesture } from '@/lib/performance';
import { quarterStatusLabel } from '@/lib/review-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/performance')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    const tools = [
      'performance:manage',
      'performance:measure',
      'performance:validate',
      'performance:read',
    ];
    if (!opens(context.me, 'performance', tools)) throw redirect({ to: '/' });
    return context;
  },
  loader: () => fetchQuarters(),
  component: PerformancePage,
});

function NewQuarter() {
  const router = useRouter();
  const [draft, setDraft] = useState({ label: '', startsOn: '', endsOn: '', progressive: false });
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={m.quarter_new()}>
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label={m.quarter_label()}
          hint={m.campaign_period_hint()}
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <TextField
          label={m.campaign_opens()}
          type="date"
          value={draft.startsOn}
          onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
        />
        <TextField
          label={m.campaign_closes()}
          type="date"
          value={draft.endsOn}
          onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
        />
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={draft.progressive}
            onChange={(e) => setDraft({ ...draft, progressive: e.target.checked })}
          />
          {m.quarter_progressive()}
        </label>
        <Button
          disabled={!draft.label || !draft.startsOn || !draft.endsOn}
          onClick={() => {
            setError(null);
            void performanceGesture({
              data: { path: '/quarters', body: draft, key: crypto.randomUUID() },
            }).then(async (answer) => {
              if (!answer.ok) return setError(refusal(answer.error));
              await router.invalidate();
            });
          }}
        >
          {m.campaign_prepare()}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </Panel>
  );
}

/**
 * Performance (spec 012), for HR, management control and the Codir: the quarters and their
 * reviews, then the job profiles — each position's grid with its six attributes.
 */
function PerformancePage() {
  const { me } = Route.useRouteContext();
  const { quarters, profiles } = Route.useLoaderData();
  const [open, setOpen] = useState<string | null>(null);
  const manages = me.administrator || me.permissions.includes('performance:manage');
  return (
    <AppShell me={me} current="performance">
      <PageTitle>{m.nav_performance()}</PageTitle>
      <p className="text-fg-muted">{m.performance_explain()}</p>
      <PageSection first title={m.performance_quarters()}>
        {quarters.length === 0 ? (
          <EmptyState title={m.performance_no_quarter()} />
        ) : (
          <ul className="grid gap-2">
            {quarters.map((q) => (
              <li key={q.quarterId}>
                <a
                  href={`/performance/${q.quarterId}`}
                  className="flex flex-wrap items-center gap-3 rounded-box border border-line bg-surface px-4 py-3 hover:border-accent"
                >
                  <span className="font-semibold">{q.label}</span>
                  <Tag
                    tone={
                      q.status === 'open' ? 'info' : q.status === 'closed' ? 'validated' : 'neutral'
                    }
                  >
                    {quarterStatusLabel(q.status)}
                  </Tag>
                  {q.progressive && <Tag>{m.quarter_progressive_tag()}</Tag>}
                  <span className="text-body-sm text-fg-muted">
                    {m.surveys_dates({ opens: q.startsOn, closes: q.endsOn })}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {manages && (
          <div className="mt-4">
            <NewQuarter />
          </div>
        )}
      </PageSection>
      <PageSection title={m.performance_profiles({ count: String(profiles.length) })}>
        <p className="mb-3 text-body-sm text-fg-muted">{m.performance_profiles_explain()}</p>
        <div className="grid gap-2">
          {profiles.map((p) => (
            <Panel key={p.profileId}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
                onClick={() => setOpen(open === p.profileId ? null : p.profileId)}
              >
                <span>
                  <span className="font-semibold">{p.title}</span>{' '}
                  <span className="text-body-sm text-fg-muted">{p.direction}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <Tag>{m.profile_lines({ count: String(p.lines.length) })}</Tag>
                  <Tag>
                    {m.profile_split({
                      individual: percent(p.weights.individual),
                      collective: percent(p.weights.collective),
                      group: percent(p.weights.group),
                    })}
                  </Tag>
                  <Tag tone={p.positions.length > 0 ? 'validated' : 'neutral'}>
                    {m.profile_positions({ count: String(p.positions.length) })}
                  </Tag>
                </span>
              </button>
              {open === p.profileId && (
                <ol className="mt-3 grid gap-2 border-t border-line pt-3 text-body-sm">
                  {p.lines.map((l) => (
                    <li
                      key={l.position}
                      className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
                    >
                      <span>
                        <span className="font-semibold">{l.name}</span>
                        <span className="block text-fg-muted">{l.source}</span>
                      </span>
                      <span>
                        {l.targetText} · {l.thresholdText}
                      </span>
                      <span className="font-number">
                        {l.weight === null ? m.line_out_of_sum() : percent(l.weight)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          ))}
        </div>
      </PageSection>
    </AppShell>
  );
}
