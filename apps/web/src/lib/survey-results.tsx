import { Panel, Tag } from '@kete/design';
import * as m from '@/paraglide/messages.js';
import type { Campaign, Group, Results } from './surveys';

export function campaignStatusLabel(status: Campaign['status']): string {
  return {
    draft: m.campaign_draft,
    open: m.campaign_open,
    closed: m.campaign_closed,
    published: m.campaign_published,
  }[status]();
}

/** A score on 100 as a bar and a number, or why there is none. */
function Score({ group }: { group: Group }) {
  if (group.hidden) return <span className="text-body-sm text-fg-muted">{m.results_hidden()}</span>;
  if (group.score === null) return <span className="text-body-sm text-fg-muted">—</span>;
  const tone =
    group.score >= 75
      ? 'bg-state-success'
      : group.score >= 50
        ? 'bg-state-verify'
        : 'bg-state-error';
  return (
    <span className="flex min-w-48 items-center gap-3">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-selected">
        <span className={`block h-full ${tone}`} style={{ width: `${group.score}%` }} />
      </span>
      <span className="font-number font-semibold">{group.score}</span>
    </span>
  );
}

function Row({ label, group }: { label: string; group: Group }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-line py-2 last:border-0">
      <span>{label}</span>
      <span className="text-body-sm text-fg-muted">
        {m.results_count({ count: String(group.count) })}
      </span>
      <Score group={group} />
    </li>
  );
}

/**
 * The results of a campaign (spec 011): on 100, per section (unit), per person about whom, per
 * question; free texts without author. A group under the minimum shows no score.
 */
export function SurveyResults({ results, campaign }: { results: Results; campaign: Campaign }) {
  return (
    <div className="grid gap-6">
      <Panel title={m.results_overall()}>
        <p className="mb-3 text-body-sm text-fg-muted">
          {m.results_explain({ forms: String(results.forms), min: String(campaign.minGroup) })}
        </p>
        <ul>
          <Row label={campaign.title} group={results.overall} />
        </ul>
      </Panel>
      <Panel title={m.results_sections()}>
        <ul>
          {results.sections.map((s) => (
            <Row key={s.key} label={s.title} group={s} />
          ))}
        </ul>
      </Panel>
      {results.people.length > 0 && (
        <Panel title={m.results_people()}>
          <ul>
            {results.people.map((p) => (
              <Row key={p.personId} label={p.name} group={p} />
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={m.results_questions()}>
        <ul>
          {results.questions.map((q) =>
            q.yes !== undefined ? (
              <li
                key={q.key}
                className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0"
              >
                <span>{q.label}</span>
                <Tag tone="info">{m.results_yes({ share: String(q.yes) })}</Tag>
              </li>
            ) : (
              <Row key={q.key} label={q.label} group={q} />
            ),
          )}
        </ul>
      </Panel>
      {results.texts.length > 0 && (
        <Panel title={m.results_texts({ count: String(results.texts.length) })}>
          <ul className="grid gap-2">
            {results.texts.map((t, i) => (
              <li key={i} className="rounded-control bg-surface-selected px-3 py-2">
                {t.text}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
