import { Button, PageHeader, PageSection, Tag, TextField, type TagTone } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import {
  checkRule,
  fetchPolicies,
  proposePolicy,
  fetchTemplates,
  savePolicy,
  setPolicyStatus,
  type Decision,
  type Policy,
  type Proposal,
} from '@/lib/policies';
import { PolicyTemplates } from '@/lib/policy-templates';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/administration/politiques')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: async () => ({ ...(await fetchPolicies()), templates: await fetchTemplates() }),
  component: PoliciesPage,
});

const statusTone: Record<Policy['status'], TagTone> = {
  active: 'validated',
  trial: 'verify',
  off: 'neutral',
};
const statusWord = (status: Policy['status']) =>
  ({ active: m.policy_active(), trial: m.policy_trial(), off: m.policy_off() })[status];
const effectTone: Record<Decision['effect'], TagTone> = {
  allow: 'validated',
  approve: 'verify',
  refuse: 'error',
};
const effectWord = (effect: Decision['effect']) =>
  ({ allow: m.policy_allowed(), approve: m.policy_asked(), refuse: m.policy_refused() })[effect];
const approverWord = (approver: string | undefined) => {
  if (!approver) return null;
  if (approver === 'manager') return m.policy_approver_manager();
  if (approver === 'on_behalf_of') return m.policy_approver_person();
  if (approver === 'project.holder') return m.policy_approver_project();
  if (approver === 'circuit') return m.policy_approver_circuit();
  return approver;
};
const when = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

/** From a sentence to a policy on trial: the model proposes, she reads, corrects, keeps. */
function NewPolicy() {
  const router = useRouter();
  const [sentence, setSentence] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [rule, setRule] = useState('');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  return (
    <div className="grid gap-3 rounded-box border border-line bg-surface p-4">
      <TextField
        id="policy-sentence"
        label={m.policy_sentence()}
        value={sentence}
        onChange={(event) => setSentence(event.target.value)}
        placeholder={m.policy_sentence_hint()}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || sentence.trim().length < 3}
          onClick={() => {
            setBusy(true);
            setError(null);
            void proposePolicy({ data: { sentence } })
              .then((answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                setProposal(answer.data.proposal);
                setRule(answer.data.proposal.rule);
                setIssues(answer.data.proposal.check.errors);
              })
              .finally(() => setBusy(false));
          }}
        >
          {m.policy_propose()}
        </Button>
      </div>
      {proposal && (
        <div className="grid gap-3">
          <p className="text-body-sm text-fg-soft">{proposal.explanation}</p>
          <label htmlFor="policy-rule" className="grid gap-1 text-body-sm font-semibold">
            {m.policy_rule()}
            <textarea
              id="policy-rule"
              value={rule}
              onChange={(event) => setRule(event.target.value)}
              className="min-h-28 rounded-control border border-line-strong bg-control p-2 font-mono text-[12.5px]"
            />
          </label>
          <p className="flex flex-wrap gap-2 text-body-sm">
            <Tag tone={proposal.set === 'approval' ? 'verify' : 'info'}>
              {proposal.set === 'approval' ? m.policy_set_approval() : m.policy_set_authority()}
            </Tag>
            {proposal.approver && <Tag>{approverWord(proposal.approver)}</Tag>}
            <button
              type="button"
              className="font-semibold text-link"
              onClick={() =>
                void checkRule({ data: { rule } }).then((answer) =>
                  setIssues(answer.ok ? answer.data.errors : [refusal(answer.error)]),
                )
              }
            >
              {m.policy_check()}
            </button>
          </p>
          {issues.length > 0 ? (
            <ul className="list-disc pl-5 text-body-sm text-state-error-fg">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-state-success-fg">{m.policy_fits()}</p>
          )}
          <TextField
            id="policy-id"
            label={m.policy_id()}
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder={m.policy_id_hint()}
          />
          <div>
            <Button
              disabled={busy || !id.trim()}
              onClick={() => {
                setBusy(true);
                setError(null);
                void savePolicy({
                  data: {
                    id,
                    sentence,
                    rule,
                    set: proposal.set,
                    ...(proposal.approver ? { approver: proposal.approver } : {}),
                  },
                })
                  .then(async (answer) => {
                    if (!answer.ok) return setError(refusal(answer.error));
                    setProposal(null);
                    setSentence('');
                    setId('');
                    await router.invalidate();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {m.policy_keep_trial()}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}

function PolicyRow({ policy }: { policy: Policy }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const change = (status: Policy['status']) =>
    void setPolicyStatus({ data: { policyId: policy.id, status } }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      await router.invalidate();
    });
  const counts = policy.lastMonth;
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{policy.sentence}</span>
        <Tag tone={statusTone[policy.status]}>{statusWord(policy.status)}</Tag>
        <Tag>{policy.set === 'approval' ? m.policy_set_approval() : m.policy_set_authority()}</Tag>
        {approverWord(policy.approver) && <Tag>{approverWord(policy.approver)}</Tag>}
        {policy.kete && <Tag tone="info">{m.policy_kete()}</Tag>}
      </div>
      <p className="flex flex-wrap gap-x-4 text-body-sm text-fg-muted">
        <span className="font-mono">
          {policy.id} · v{policy.version}
        </span>
        <span>
          {m.policy_month({
            allowed: String(counts.allowed),
            asked: String(counts.asked),
            refused: String(counts.refused),
          })}
        </span>
        {counts.trial > 0 && <span>{m.policy_month_trial({ count: String(counts.trial) })}</span>}
      </p>
      <details>
        <summary className="cursor-pointer text-body-sm font-semibold text-link">
          {m.policy_see_rule()}
        </summary>
        <pre className="mt-1 overflow-x-auto rounded-control bg-bg p-2 font-mono text-[12px] whitespace-pre-wrap">
          {policy.rule}
        </pre>
      </details>
      {!policy.kete && !policy.id.startsWith('rul_') && (
        <div className="flex flex-wrap gap-2">
          {policy.status !== 'active' && (
            <Button variant="secondary" onClick={() => change('active')}>
              {m.policy_switch_on()}
            </Button>
          )}
          {policy.status === 'active' && (
            <Button variant="secondary" onClick={() => change('trial')}>
              {m.policy_back_trial()}
            </Button>
          )}
          {policy.status !== 'off' && (
            <Button variant="secondary" onClick={() => change('off')}>
              {m.policy_switch_off()}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-body-sm text-state-error-fg">{error}</p>}
    </li>
  );
}

/** The policies (doctrine D-058, spec 090): one engine for people and agents, all journaled. */
function PoliciesPage() {
  const { me } = Route.useRouteContext();
  const { policies, decisions, templates } = Route.useLoaderData();
  return (
    <AppShell me={me} current="policies">
      <PageHeader title={m.nav_policies()} description={m.policy_subtitle()} />
      {templates.length > 0 && (
        <PageSection first title={m.policy_templates()}>
          <PolicyTemplates templates={templates} />
        </PageSection>
      )}
      <PageSection first={templates.length === 0} title={m.policy_new()}>
        <NewPolicy />
      </PageSection>
      <PageSection title={m.policy_list({ count: String(policies.length) })}>
        <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
          {policies.map((policy) => (
            <PolicyRow key={policy.id} policy={policy} />
          ))}
        </ul>
      </PageSection>
      <PageSection title={m.policy_journal()}>
        {decisions.length === 0 ? (
          <p className="text-fg-muted">{m.policy_journal_empty()}</p>
        ) : (
          <div className="overflow-x-auto rounded-box border border-line bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-fg-muted uppercase">
                  <th className="px-3 py-2">{m.policy_when()}</th>
                  <th className="px-3 py-2">{m.policy_gesture()}</th>
                  <th className="px-3 py-2">{m.policy_who()}</th>
                  <th className="px-3 py-2">{m.policy_decided()}</th>
                  <th className="px-3 py-2">{m.policy_by()}</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.decisionId} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{when(d.at)}</td>
                    <td className="px-3 py-2 font-mono">{d.gesture.kind}</td>
                    <td className="px-3 py-2">
                      {d.gesture.actor.kind === 'agent'
                        ? m.policy_agent_for({ id: d.gesture.actor.id })
                        : d.gesture.actor.id}
                    </td>
                    <td className="px-3 py-2">
                      <Tag tone={effectTone[d.effect]}>{effectWord(d.effect)}</Tag>
                    </td>
                    <td className="px-3 py-2">
                      {d.policies.map((p) => `${p.reason} (v${p.version})`).join(' · ')}
                      {d.trial.length > 0 && (
                        <span className="block text-fg-muted">
                          {m.policy_trial_said({ what: d.trial.map((p) => p.reason).join(' · ') })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </AppShell>
  );
}
