import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import {
  changeAgents,
  fetchAgentRecord,
  understandAgent,
  type AgentProposal,
  type AgentRecord,
  type AgentsScreen,
  type AgentTask,
  type AgentView,
} from './agents';
import { DialogForm, GestureForm, refusal, Select } from './forms';
import { HowButton } from './how-view';
import { permissionLabel } from './rights-view';

export function signalLabel(kind: string): string {
  const labels: Record<string, () => string> = {
    'registry.no_card': m.signal_registry_no_card,
    'registry.no_owner': m.signal_registry_no_owner,
    'decisions.overdue': m.signal_decisions_overdue,
    'compliance.control_failing': m.signal_compliance_control_failing,
    'compliance.control_expired': m.signal_compliance_control_expired,
    'compliance.control_missing': m.signal_compliance_control_missing,
    'compliance.action_overdue': m.signal_compliance_action_overdue,
    'compliance.certificate_expiring': m.signal_compliance_certificate_expiring,
  };
  return labels[kind]?.() ?? kind;
}

function watchLabel(watch: string): string {
  const labels: Record<string, () => string> = {
    registry: m.watch_registry,
    decisions: m.watch_decisions,
    compliance: m.watch_compliance,
  };
  return labels[watch]?.() ?? watch;
}

function useGesture() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const send = (path: string, body: object = {}) => {
    setError(null);
    void changeAgents({ data: { path, body, key: crypto.randomUUID() } }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      await router.invalidate();
    });
  };
  return { error, send };
}

const taskLabel = (status: AgentTask['status']) =>
  ({
    queued: m.agent_task_queued,
    running: m.agent_task_running,
    done: m.agent_task_done,
    failed: m.agent_task_failed,
    stopped: m.agent_task_stopped,
  })[status]();

/** The tasks given to the agent (spec 036): a new one, the latest with their answers. */
function AgentTasks({
  agent,
  send,
}: {
  agent: AgentView;
  send: (path: string, body?: object) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const tasks = agent.tasks ?? [];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body-sm font-semibold">{m.agent_tasks()}</h3>
        {agent.status === 'active' && (
          <DialogForm
            title={m.agent_give_task()}
            ready={instruction.trim().length > 0}
            onSubmit={() => {
              send(`/${agent.agentId}/tasks`, { instruction });
              setInstruction('');
            }}
          >
            <p className="text-body-sm text-fg-muted">{m.agent_task_explain()}</p>
            <label className="grid gap-1.5 text-body-sm font-semibold">
              {m.agent_task_instruction()}
              <textarea
                className="min-h-28 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                value={instruction}
                maxLength={4000}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </label>
          </DialogForm>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{m.agent_no_task()}</p>
      ) : (
        <ul className="grid gap-2">
          {tasks.map((t) => (
            <li
              key={t.taskId}
              className="grid gap-1 rounded-box border border-line p-3 text-body-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Tag
                  tone={
                    t.status === 'done' ? 'validated' : t.status === 'failed' ? 'error' : 'info'
                  }
                >
                  {taskLabel(t.status)}
                </Tag>
                {t.parentTaskId && <Tag tone="agent">{m.agent_task_delegated()}</Tag>}
                <span className="font-semibold">{t.instruction}</span>
                {(t.status === 'queued' || t.status === 'running') && (
                  <Button variant="secondary" onClick={() => send(`/tasks/${t.taskId}/stop`)}>
                    {m.agent_task_stop()}
                  </Button>
                )}
              </div>
              {t.answer && <p className="whitespace-pre-line">{t.answer}</p>}
              {t.status !== 'queued' && (
                <div>
                  <HowButton taskId={t.taskId} />
                </div>
              )}
              {t.draftIds.length > 0 && (
                <a href="/a-faire" className="font-semibold text-link underline">
                  {m.agent_task_drafts({ count: t.draftIds.length })}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const levelWords: Record<number, () => string> = {
  1: m.agent_level_1,
  2: m.agent_level_2,
  3: m.agent_level_3,
};

/** Its level per kind of task — per permission it holds — never above its maximum (spec 052). */
function AgentAutonomy({
  agent,
  send,
}: {
  agent: AgentView;
  send: (path: string, body?: object) => void;
}) {
  if (agent.permissions.length === 0) return null;
  const levels = [1, 2, 3].filter((l) => l <= agent.autonomyMax);
  return (
    <div className="grid gap-2">
      <h3 className="text-body-sm font-semibold">{m.agent_autonomy()}</h3>
      <p className="text-body-sm text-fg-muted">{m.agent_autonomy_explain()}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {agent.permissions.map((p) => (
          <Select
            key={p}
            label={permissionLabel(p)}
            value={String(agent.autonomyByPermission[p] ?? '')}
            onChange={(e) =>
              send(`/${agent.agentId}/autonomy`, {
                permission: p,
                level: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">
              {m.agent_level_default({ level: String(Math.min(agent.autonomyMax, 3)) })}
            </option>
            {levels.map((l) => (
              <option key={l} value={String(l)}>
                {levelWords[l]?.() ?? String(l)}
              </option>
            ))}
          </Select>
        ))}
      </div>
    </div>
  );
}

/** What it did this week: its tasks, its drafts and what she decided, its signals (spec 052). */
function AgentWeek({ agent }: { agent: AgentView }) {
  const [record, setRecord] = useState<AgentRecord | null>(null);
  return (
    <div className="grid gap-1">
      {record ? (
        <>
          <h3 className="text-body-sm font-semibold">{m.agent_record()}</h3>
          <p className="text-body-sm">
            {m.agent_record_tasks({
              done: String(record.tasks.done),
              failed: String(record.tasks.failed),
              open: String(record.tasks.open),
            })}
          </p>
          <p className="text-body-sm">
            {m.agent_record_drafts({
              validated: String(record.drafts.validated),
              refused: String(record.drafts.refused),
              open: String(record.drafts.open),
            })}
          </p>
          <p className="text-body-sm">
            {m.agent_record_signals({
              raised: String(record.signals.raised),
              closed: String(record.signals.closed),
            })}
          </p>
        </>
      ) : (
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              void fetchAgentRecord({ data: { agentId: agent.agentId } }).then((r) =>
                setRecord(r.record),
              )
            }
          >
            {m.agent_record_show()}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A personal agent from her sentence: its job description and plan, then « Créer » (spec 052). */
function AgentFromSentence({ watchLabelOf }: { watchLabelOf: (w: string) => string }) {
  const router = useRouter();
  const [sentence, setSentence] = useState('');
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title={m.agent_from_sentence()}>
      <div className="grid gap-3">
        <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
          {m.agent_sentence()}
          <textarea
            value={sentence}
            rows={2}
            maxLength={1000}
            onChange={(e) => {
              setSentence(e.target.value);
              setProposal(null);
            }}
            className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal"
          />
          <span className="font-normal text-fg-muted">{m.agent_sentence_hint()}</span>
        </label>
        {!proposal && (
          <div>
            <Button
              disabled={busy || sentence.trim().length < 3}
              onClick={() => {
                setBusy(true);
                setNotice(null);
                void understandAgent({ data: { sentence } })
                  .then((answer) =>
                    answer.ok && answer.proposal
                      ? setProposal(answer.proposal)
                      : setNotice({ ok: false, text: refusal(answer.error) }),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {m.agent_understand()}
            </Button>
          </div>
        )}
        {proposal && (
          <div className="grid gap-2 rounded-box border border-line bg-surface-muted p-4">
            <p className="text-body-sm font-semibold">{m.agent_proposal()}</p>
            <p className="font-semibold">{proposal.name}</p>
            <p>{proposal.mission}</p>
            <div className="flex flex-wrap gap-2">
              {proposal.watches.map((w) => (
                <Tag key={w}>{watchLabelOf(w)}</Tag>
              ))}
              {proposal.permissions.map((p) => (
                <Tag key={p} tone="info">
                  {permissionLabel(p)}
                </Tag>
              ))}
            </div>
            <p className="text-body-sm text-fg-muted">
              {m.agent_proposal_level({
                level: String(proposal.autonomyMax),
                minutes: String(proposal.wakeEveryMinutes),
              })}
            </p>
            <ol className="grid list-decimal gap-1 pl-5">
              {proposal.plan.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void changeAgents({
                    data: {
                      path: '/',
                      body: {
                        name: proposal.name,
                        kind: 'personal',
                        mission: proposal.mission,
                        permissions: proposal.permissions,
                        watches: proposal.watches,
                        autonomyMax: proposal.autonomyMax,
                        wakeEveryMinutes: proposal.wakeEveryMinutes,
                      },
                      key: crypto.randomUUID(),
                    },
                  })
                    .then(async (answer) => {
                      if (!answer.ok) return setNotice({ ok: false, text: refusal(answer.error) });
                      setNotice({ ok: true, text: m.agent_created() });
                      setProposal(null);
                      setSentence('');
                      await router.invalidate();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {m.agent_create()}
              </Button>
              <Button variant="secondary" onClick={() => setProposal(null)}>
                {m.agent_rephrase()}
              </Button>
            </div>
          </div>
        )}
        {notice && (
          <p
            role={notice.ok ? 'status' : 'alert'}
            className={notice.ok ? 'text-body-sm' : 'text-body-sm text-state-error-fg'}
          >
            {notice.text}
          </p>
        )}
      </div>
    </Panel>
  );
}

function AgentCard({ agent, unitName }: { agent: AgentView; unitName: Map<string, string> }) {
  const { error, send } = useGesture();
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <Panel title={agent.name}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="agent">{m.agent_level({ level: String(agent.autonomyMax) })}</Tag>
          <Tag tone={agent.status === 'active' ? 'validated' : 'neutral'}>
            {agent.status === 'active' ? m.agent_active() : m.agent_paused()}
          </Tag>
          {agent.watches.map((w) => (
            <Tag key={w}>{watchLabel(w)}</Tag>
          ))}
        </div>
        <p>{agent.mission}</p>
        <p className="text-body-sm text-fg-muted">
          {[
            agent.scopeUnitId
              ? m.agent_scope({ unit: unitName.get(agent.scopeUnitId) ?? '…' })
              : m.agent_scope_all(),
            agent.permissions.length > 0
              ? agent.permissions.map((p) => permissionLabel(p)).join(', ')
              : m.agent_no_permission(),
            m.agent_every({ minutes: String(agent.wakeEveryMinutes) }),
            agent.lastRunAt
              ? m.agent_last_run({ at: format.format(new Date(agent.lastRunAt)) })
              : m.agent_never_run(),
          ].join(' · ')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send(`/${agent.agentId}/wake`)}>
            {m.agent_wake()}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              send(`/${agent.agentId}/status`, {
                status: agent.status === 'active' ? 'paused' : 'active',
              })
            }
          >
            {agent.status === 'active' ? m.agent_pause() : m.agent_resume()}
          </Button>
        </div>
        <AgentAutonomy agent={agent} send={send} />
        <AgentWeek agent={agent} />
        <AgentTasks agent={agent} send={send} />
        <div>
          <h3 className="mb-2 text-body-sm font-semibold">{m.agent_signals()}</h3>
          {agent.signals.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{m.agent_no_signal()}</p>
          ) : (
            <ul className="grid gap-2">
              {agent.signals.map((s) => (
                <li key={s.signalId} className="flex flex-wrap items-center gap-2 text-body-sm">
                  <Tag tone="verify">{signalLabel(s.kind)}</Tag>
                  <span className="font-semibold">{s.subject}</span>
                  <Button variant="secondary" onClick={() => send(`/signals/${s.signalId}/close`)}>
                    {m.agent_resolve()}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

export function AgentsView({ screen }: { screen: AgentsScreen }) {
  const unitName = new Map(screen.chart.units.map((u) => [u.unitId, u.name]));
  const [draft, setDraft] = useState({
    name: '',
    kind: 'personal' as AgentView['kind'],
    positionId: '',
    mission: '',
    scopeUnitId: '',
    permissions: [] as string[],
    watches: [] as string[],
    wakeEveryMinutes: '60',
  });
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((v) => v !== value);
  return (
    <div className="grid gap-6">
      <AgentFromSentence watchLabelOf={watchLabel} />
      {screen.agents.length === 0 ? (
        <p className="text-fg-muted">{m.agents_none()}</p>
      ) : (
        screen.agents.map((agent) => (
          <AgentCard key={agent.agentId} agent={agent} unitName={unitName} />
        ))
      )}
      <GestureForm
        title={m.agent_new()}
        ready={
          draft.name.trim() !== '' &&
          draft.mission.trim() !== '' &&
          draft.watches.length > 0 &&
          (draft.kind !== 'position' || draft.positionId !== '')
        }
        send={(key) =>
          changeAgents({
            data: {
              path: '/',
              body: {
                name: draft.name,
                kind: draft.kind,
                mission: draft.mission,
                ...(draft.kind === 'position' ? { positionId: draft.positionId } : {}),
                ...(draft.scopeUnitId ? { scopeUnitId: draft.scopeUnitId } : {}),
                permissions: draft.permissions,
                watches: draft.watches,
                wakeEveryMinutes: Number(draft.wakeEveryMinutes) || 60,
              },
              key,
            },
          })
        }
        onDone={() => setDraft({ ...draft, name: '', mission: '' })}
      >
        <TextField
          label={m.field_name()}
          value={draft.name}
          required
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <TextField
          label={m.agent_mission()}
          value={draft.mission}
          required
          onChange={(e) => setDraft({ ...draft, mission: e.target.value })}
        />
        <Select
          label={m.agent_kind()}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as AgentView['kind'] })}
        >
          <option value="personal">{m.agent_kind_personal()}</option>
          {screen.manages && <option value="position">{m.agent_kind_position()}</option>}
          {screen.manages && <option value="system">{m.agent_kind_system()}</option>}
        </Select>
        {draft.kind === 'position' && (
          <Select
            label={m.field_position()}
            value={draft.positionId}
            onChange={(e) => setDraft({ ...draft, positionId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {screen.chart.positions.map((p) => (
              <option key={p.positionId} value={p.positionId}>
                {`${p.title} · ${unitName.get(p.unitId) ?? ''}`}
              </option>
            ))}
          </Select>
        )}
        <Select
          label={m.rights_scope()}
          value={draft.scopeUnitId}
          onChange={(e) => setDraft({ ...draft, scopeUnitId: e.target.value })}
        >
          <option value="">{m.agent_scope_all()}</option>
          {screen.chart.units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {m.rights_scope_unit({ unit: u.name })}
            </option>
          ))}
        </Select>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-semibold">{m.agent_watches()}</legend>
          {screen.watches.map((w) => (
            <label key={w} className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={draft.watches.includes(w)}
                onChange={(e) =>
                  setDraft({ ...draft, watches: toggle(draft.watches, w, e.target.checked) })
                }
              />
              {watchLabel(w)}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-semibold">{m.rights_permissions()}</legend>
          {screen.permissions.map((p) => (
            <label key={p} className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={draft.permissions.includes(p)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: toggle(draft.permissions, p, e.target.checked),
                  })
                }
              />
              {permissionLabel(p)}
            </label>
          ))}
        </fieldset>
        <TextField
          label={m.agent_wake_every()}
          type="number"
          min={5}
          value={draft.wakeEveryMinutes}
          onChange={(e) => setDraft({ ...draft, wakeEveryMinutes: e.target.value })}
        />
      </GestureForm>
    </div>
  );
}
