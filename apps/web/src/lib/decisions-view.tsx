import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { changeDecisions, type InboxRequest, type InboxScreen, type Rule } from './decisions';
import { GestureForm, refusal, Select } from './forms';

export function subjectLabel(subject: string): string {
  const labels: Record<string, () => string> = {
    'registry.promotion': m.subject_registry_promotion,
  };
  return labels[subject]?.() ?? subject;
}

function statusLabel(status: string): string {
  const labels: Record<string, () => string> = {
    pending: m.status_pending,
    approved: m.status_approved,
    refused: m.status_refused,
    skipped: m.status_skipped,
  };
  return labels[status]?.() ?? status;
}

function ruleLabel(rule: Rule): string {
  return {
    manager: m.rule_manager,
    role: m.rule_role,
    position: m.rule_position,
    person: m.rule_person,
  }[rule.rule]();
}

/** One request to decide: approve, or refuse with a reason. */
function Decide({ request }: { request: InboxRequest }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = (decision: 'approve' | 'refuse') => {
    setError(null);
    void changeDecisions({
      data: {
        path: `/requests/${request.requestId}/decide`,
        body: { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        key: crypto.randomUUID(),
      },
    }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      await router.invalidate();
    });
  };
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{request.title}</span>
        <Tag>{subjectLabel(request.subject)}</Tag>
        {request.overdue && <Tag tone="verify">{m.inbox_overdue()}</Tag>}
        <span className="text-body-sm text-fg-muted">
          {m.inbox_step({
            step: String(request.currentStep ?? ''),
            total: String(request.steps.length),
          })}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <TextField
          className="min-w-64"
          label={m.inbox_reason()}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button onClick={() => decide('approve')}>{m.approve()}</Button>
        <Button variant="secondary" onClick={() => decide('refuse')}>
          {m.refuse()}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

type StepDraft = { rule: Rule['rule']; target: string; minMeasure: string };

/** The circuits, and the form to describe one (a new one replaces the active one of its subject). */
function Circuits({ circuits }: { circuits: NonNullable<InboxScreen['circuits']> }) {
  const [draft, setDraft] = useState({
    subject: circuits.subjects[0] ?? '',
    name: '',
    remindAfterHours: '48',
  });
  const [steps, setSteps] = useState<StepDraft[]>([
    { rule: 'manager', target: '', minMeasure: '' },
  ]);
  const unitName = new Map(circuits.chart.units.map((u) => [u.unitId, u.name]));
  const toRule = (s: StepDraft): Rule =>
    s.rule === 'role'
      ? { rule: 'role', roleId: s.target }
      : s.rule === 'position'
        ? { rule: 'position', positionId: s.target }
        : s.rule === 'person'
          ? { rule: 'person', personId: s.target }
          : { rule: 'manager' };
  const complete = steps.every((s) => s.rule === 'manager' || s.target !== '');
  return (
    <div className="grid gap-6">
      <Panel title={m.circuits_title()}>
        {circuits.circuits.length === 0 ? (
          <p className="text-fg-muted">{m.circuits_none()}</p>
        ) : (
          <ul className="grid gap-3">
            {circuits.circuits.map((c) => (
              <li key={c.circuitId}>
                <span className="font-semibold">{c.name}</span> <Tag>{subjectLabel(c.subject)}</Tag>
                <ol className="mt-1 ml-5 list-decimal text-body-sm text-fg-muted">
                  {c.steps.map((s) => (
                    <li key={s.position}>
                      {ruleLabel(s.rule)}
                      {s.minMeasure !== null &&
                        ` · ${m.circuit_from({ measure: String(s.minMeasure) })}`}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <GestureForm
        title={m.circuit_new()}
        ready={draft.subject !== '' && draft.name.trim() !== '' && complete}
        send={(key) =>
          changeDecisions({
            data: {
              path: '/circuits',
              body: {
                subject: draft.subject,
                name: draft.name,
                remindAfterHours: Number(draft.remindAfterHours) || 48,
                steps: steps.map((s) => ({
                  ...toRule(s),
                  ...(s.minMeasure.trim() ? { minMeasure: Number(s.minMeasure) } : {}),
                })),
              },
              key,
            },
          })
        }
        onDone={() => setDraft({ ...draft, name: '' })}
      >
        <Select
          label={m.circuit_subject()}
          value={draft.subject}
          onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
        >
          {circuits.subjects.map((s) => (
            <option key={s} value={s}>
              {subjectLabel(s)}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_name()}
          value={draft.name}
          required
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <TextField
          label={m.circuit_remind()}
          type="number"
          min={1}
          value={draft.remindAfterHours}
          onChange={(e) => setDraft({ ...draft, remindAfterHours: e.target.value })}
        />
        {steps.map((step, index) => (
          <fieldset key={index} className="grid gap-2 rounded-control border border-line p-3">
            <legend className="px-1 text-body-sm font-semibold">
              {m.circuit_step({ step: String(index + 1) })}
            </legend>
            <Select
              label={m.circuit_rule()}
              value={step.rule}
              onChange={(e) =>
                setSteps(
                  steps.map((s, i) =>
                    i === index ? { ...s, rule: e.target.value as Rule['rule'], target: '' } : s,
                  ),
                )
              }
            >
              {(['manager', 'role', 'position', 'person'] as const).map((r) => (
                <option key={r} value={r}>
                  {ruleLabel({ rule: r } as Rule)}
                </option>
              ))}
            </Select>
            {step.rule !== 'manager' && (
              <Select
                label={m.circuit_who()}
                value={step.target}
                onChange={(e) =>
                  setSteps(
                    steps.map((s, i) => (i === index ? { ...s, target: e.target.value } : s)),
                  )
                }
              >
                <option value="">{m.field_choose()}</option>
                {step.rule === 'role' &&
                  circuits.roles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.name}
                    </option>
                  ))}
                {step.rule === 'position' &&
                  circuits.chart.positions.map((p) => (
                    <option key={p.positionId} value={p.positionId}>
                      {`${p.title} · ${unitName.get(p.unitId) ?? ''}`}
                    </option>
                  ))}
                {step.rule === 'person' &&
                  circuits.chart.people.map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            )}
            <TextField
              label={m.circuit_threshold()}
              hint={m.circuit_threshold_hint()}
              type="number"
              min={0}
              value={step.minMeasure}
              onChange={(e) =>
                setSteps(
                  steps.map((s, i) => (i === index ? { ...s, minMeasure: e.target.value } : s)),
                )
              }
            />
          </fieldset>
        ))}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setSteps([...steps, { rule: 'manager', target: '', minMeasure: '' }])}
          >
            {m.circuit_add_step()}
          </Button>
          {steps.length > 1 && (
            <Button variant="secondary" onClick={() => setSteps(steps.slice(0, -1))}>
              {m.circuit_remove_step()}
            </Button>
          )}
        </div>
      </GestureForm>
    </div>
  );
}

export function InboxView({ screen }: { screen: InboxScreen }) {
  return (
    <div className="grid gap-6">
      <Panel title={m.inbox_to_decide()}>
        {screen.toDecide.length === 0 ? (
          <p className="text-fg-muted">{m.nothing_to_decide()}</p>
        ) : (
          <ul>
            {screen.toDecide.map((r) => (
              <Decide key={r.requestId} request={r} />
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={m.inbox_mine()}>
        {screen.mine.length === 0 ? (
          <p className="text-fg-muted">{m.inbox_mine_empty()}</p>
        ) : (
          <ul className="grid gap-2">
            {screen.mine.map((r) => (
              <li key={r.requestId} className="flex flex-wrap items-center gap-2 text-body-sm">
                <span className="font-semibold">{r.title}</span>
                <Tag
                  tone={
                    r.status === 'approved'
                      ? 'validated'
                      : r.status === 'refused'
                        ? 'error'
                        : 'info'
                  }
                >
                  {statusLabel(r.status)}
                </Tag>
                <span className="text-fg-muted">
                  {r.steps.map((s) => statusLabel(s.status)).join(' → ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {screen.circuits && <Circuits circuits={screen.circuits} />}
    </div>
  );
}
