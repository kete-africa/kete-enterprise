import { PageSection, PageHeader, Panel, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchConnection, setPersonalPolicy, type PersonalPolicy } from '@/lib/ai';
import { fetchGovernance, journalCsv, type JournalLine } from '@/lib/governance';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchUsage, setBudget } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/administration/ia')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: async () => {
    const [usage, connection, governance] = await Promise.all([
      fetchUsage(),
      fetchConnection(),
      fetchGovernance(),
    ]);
    return {
      ...usage,
      policy: connection.policy,
      secrets: connection.available,
      governance: governance.governance,
      journal: governance.journal,
    };
  },
  component: AiPage,
});

/**
 * The organization's use of models (spec 014): which model, how much this month by purpose, and
 * the monthly budget past which no call is made. The model is chosen by the instance's environment,
 * never from a screen; its key never shows.
 */
function AiPage() {
  const { me } = Route.useRouteContext();
  const usage = Route.useLoaderData();
  const router = useRouter();
  const [budget, setDraft] = useState(
    usage.monthlyTokens === null ? '' : String(usage.monthlyTokens),
  );
  const [error, setError] = useState<string | null>(null);
  const total = usage.purposes.reduce((s, p) => s + p.tokens, 0);
  const [policy, setPolicyDraft] = useState<PersonalPolicy>(usage.policy);
  const purposeLabel = (purpose: string) => {
    const [base, payer] = purpose.split(':');
    const label =
      base === 'chat' ? m.ai_purpose_chat() : base === 'briefing' ? m.ai_purpose_briefing() : base;
    return payer === 'personal' ? m.ai_purpose_personal({ purpose: label ?? '' }) : label;
  };
  return (
    <AppShell me={me} current="ai">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_ai()}
      />
      <PageSection first title={m.ai_model()}>
        <Panel>
          <p>
            {usage.model
              ? m.ai_model_is({ provider: usage.provider ?? '', model: usage.model })
              : m.ai_no_model()}
          </p>
          <p className="mt-2 text-body-sm text-fg-muted">{m.ai_model_explain()}</p>
        </Panel>
      </PageSection>
      <PageSection title={m.ai_usage({ tokens: total.toLocaleString() })}>
        <Panel>
          <ul className="grid gap-1 text-body-sm">
            {usage.purposes.map((p) => (
              <li key={p.purpose} className="flex justify-between gap-3">
                <span>{purposeLabel(p.purpose)}</span>
                <span className="font-number">
                  {m.ai_purpose_line({ calls: String(p.calls), tokens: p.tokens.toLocaleString() })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </PageSection>
      <PageSection title={m.ai_policy()}>
        <Panel>
          <p className="mb-3">
            {usage.policy === 'off'
              ? m.ai_policy_off()
              : usage.policy === 'required'
                ? m.ai_policy_required()
                : m.ai_policy_allowed()}
          </p>
          <DialogForm
            title={m.ai_policy()}
            ready
            onSubmit={() => {
              setError(null);
              void setPersonalPolicy({ data: { personal: policy } }).then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                await router.invalidate();
              });
            }}
          >
            <Select
              label={m.ai_policy()}
              value={policy}
              onChange={(e) => setPolicyDraft(e.target.value as PersonalPolicy)}
            >
              <option value="allowed">{m.ai_policy_allowed()}</option>
              <option value="required">{m.ai_policy_required()}</option>
              <option value="off">{m.ai_policy_off()}</option>
            </Select>
          </DialogForm>
          {!usage.secrets && (
            <p className="mt-2 text-body-sm text-state-verify-fg">
              {m.ai_connection_unavailable()}
            </p>
          )}
        </Panel>
      </PageSection>
      <PageSection title={m.ai_budget()}>
        <Panel>
          <p className="mb-3 font-number text-title font-semibold">
            {usage.monthlyTokens === null ? '—' : usage.monthlyTokens.toLocaleString()}
          </p>
          <DialogForm
            title={m.ai_budget()}
            ready={budget !== ''}
            onSubmit={() => {
              setError(null);
              void setBudget({ data: { monthlyTokens: Number(budget) } }).then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                await router.invalidate();
              });
            }}
          >
            <TextField
              label={m.ai_budget_tokens()}
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setDraft(e.target.value)}
            />
          </DialogForm>
          <p className="mt-2 text-body-sm text-fg-muted">{m.ai_budget_explain()}</p>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </Panel>
      </PageSection>
      <Governance governance={usage.governance} journal={usage.journal} />
    </AppShell>
  );
}

const cell = 'px-2 py-1.5';

/** What the organization spent, found useful, saw fail, and what its AI did (spec 054). */
function Governance({
  governance,
  journal,
}: {
  governance: Awaited<ReturnType<typeof fetchGovernance>>['governance'];
  journal: JournalLine[];
}) {
  const number = new Intl.NumberFormat(getLocale());
  const when = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' });
  const exportJournal = () => {
    const csv = journalCsv(journal, [
      m.governance_at(),
      m.governance_actor(),
      m.governance_for(),
      m.governance_channel(),
      m.governance_action(),
      m.governance_summary(),
      m.governance_reversible(),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `journal-ia-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageSection title={m.governance_teams()}>
        <Panel>
          {governance.teams.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{m.governance_none()}</p>
          ) : (
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-fg-muted">
                  <th className={cell}>{m.governance_team()}</th>
                  <th className={`${cell} text-right`}>{m.governance_calls()}</th>
                  <th className={`${cell} text-right`}>{m.governance_tokens()}</th>
                  <th className={`${cell} text-right`}>{m.governance_people()}</th>
                </tr>
              </thead>
              <tbody>
                {governance.teams.map((team) => (
                  <tr key={team.unitId ?? 'none'} className="border-t border-line">
                    <td className={cell}>{team.unit ?? m.governance_no_team()}</td>
                    <td className={`${cell} text-right font-number`}>
                      {number.format(team.calls)}
                    </td>
                    <td className={`${cell} text-right font-number`}>
                      {number.format(team.tokens)}
                    </td>
                    <td className={`${cell} text-right font-number`}>
                      {number.format(team.people)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </PageSection>
      <PageSection title={m.governance_feedback()}>
        <Panel>
          <p>
            {governance.feedback.judged === 0
              ? m.governance_feedback_none()
              : m.governance_feedback_share({
                  helpful: number.format(governance.feedback.helpful),
                  judged: number.format(governance.feedback.judged),
                })}
          </p>
          <p className="mt-2 text-body-sm text-fg-muted">
            {m.governance_failures()} :{' '}
            {m.governance_failures_line({
              tasks: number.format(governance.failures.tasks),
              routines: number.format(governance.failures.routines),
            })}
          </p>
        </Panel>
      </PageSection>
      <PageSection title={m.governance_journal()}>
        <Panel>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="flex-1 text-body-sm text-fg-muted">{m.governance_journal_explain()}</p>
            {journal.length > 0 && (
              <button
                type="button"
                onClick={exportJournal}
                className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
              >
                {m.governance_export()}
              </button>
            )}
          </div>
          {journal.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{m.governance_journal_none()}</p>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className={cell}>{m.governance_at()}</th>
                    <th className={cell}>{m.governance_actor()}</th>
                    <th className={cell}>{m.governance_for()}</th>
                    <th className={cell}>{m.governance_channel()}</th>
                    <th className={cell}>{m.governance_summary()}</th>
                    <th className={cell}>{m.governance_reversible()}</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.slice(0, 100).map((line, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className={`${cell} whitespace-nowrap`}>
                        {when.format(new Date(line.at))}
                      </td>
                      <td className={cell}>{line.actor}</td>
                      <td className={cell}>{line.onBehalfOf ?? '—'}</td>
                      <td className={cell}>{line.channel}</td>
                      <td className={cell}>{line.summary ?? line.command}</td>
                      <td className={cell}>
                        {line.reversible ? m.governance_yes() : m.governance_no()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </PageSection>
    </>
  );
}
