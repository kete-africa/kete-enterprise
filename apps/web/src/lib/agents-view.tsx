import { Button, Panel, Tag, TextField, type TagTone } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import {
  changeAgents,
  createAgentAndRun,
  dryRunAgent,
  fetchAgentRecord,
  understandAgent,
  type AgentProposal,
  type AgentRecord,
  type AgentsScreen,
  type AgentState,
  type AgentTask,
  type AgentView,
  type DryRunFinding,
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
    paused: m.agent_task_paused,
    taken_over: m.agent_task_taken_over,
  })[status]();

const moment = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );

const stateWords: Record<AgentState['kind'], () => string> = {
  idle: m.agent_state_idle,
  working: m.agent_state_working,
  waiting: m.agent_state_waiting,
  blocked: m.agent_state_blocked,
  paused: m.agent_state_paused,
  stopped: m.agent_state_stopped,
};
const stateTone: Record<AgentState['kind'], TagTone> = {
  idle: 'neutral',
  working: 'agent',
  waiting: 'verify',
  blocked: 'error',
  paused: 'info',
  stopped: 'neutral',
};

/** What a state shows beside its name: one line, the same wherever the agent appears. */
function stateDetail(state: AgentState): string {
  switch (state.kind) {
    case 'idle':
      return state.since ? m.agent_state_idle_detail({ at: moment(state.since) }) : '';
    case 'working':
      return m.agent_state_working_detail({
        instruction: state.instruction ?? '',
        steps: String(state.steps ?? 0),
      });
    case 'waiting':
      return m.agent_state_waiting_detail({ count: String(state.drafts ?? 0) });
    case 'blocked':
      return m.agent_state_blocked_detail({
        instruction: state.instruction ?? '',
        reason: refusal(state.reason ?? null),
      });
    case 'paused':
      return state.by && state.since
        ? m.agent_state_paused_detail({ name: state.by, at: moment(state.since) })
        : m.agent_state_paused_agent();
    case 'stopped':
      return m.agent_state_stopped_detail();
  }
}

/** The agent's state: its name and its line (spec 066). */
export function AgentStateLine({ state }: { state: AgentState }) {
  const detail = stateDetail(state);
  return (
    <p className="flex flex-wrap items-center gap-2 text-body-sm">
      <Tag tone={stateTone[state.kind]}>{stateWords[state.kind]()}</Tag>
      {detail && <span className="text-fg-muted">{detail}</span>}
    </p>
  );
}

const live = (status: AgentTask['status']) =>
  status === 'queued' || status === 'running' || status === 'paused';

/**
 * One task (spec 036), steered while it works (spec 066): pause it, go on, write to it, take the
 * work over, stop it. Its steps show as they happen; what she asked shows until it obeys.
 */
function TaskRow({
  task,
  agentName,
  send,
}: {
  task: AgentTask;
  agentName?: string;
  send: (path: string, body?: object) => void;
}) {
  const [words, setWords] = useState('');
  const last = task.steps.at(-1);
  const steered = task.steeredBy
    ? { name: task.steeredBy.name, at: moment(task.steeredBy.at) }
    : null;
  return (
    <li className="grid gap-1 rounded-box border border-line p-3 text-body-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Tag
          tone={task.status === 'done' ? 'validated' : task.status === 'failed' ? 'error' : 'info'}
        >
          {taskLabel(task.status)}
        </Tag>
        {agentName && <Tag tone="agent">{agentName}</Tag>}
        {task.parentTaskId && <Tag tone="agent">{m.agent_task_delegated()}</Tag>}
        <span className="font-semibold">{task.instruction}</span>
      </div>
      {last && live(task.status) && (
        <p className="text-fg-muted">
          {m.agent_task_steps({ count: String(task.steps.length), step: last.tool })}
        </p>
      )}
      {task.notes.map((note, index) => (
        <p key={index} className="rounded-control bg-surface px-2 py-1">
          {m.agent_task_note({ text: note.text })}
        </p>
      ))}
      {task.control && <p className="text-fg-muted">{m.agent_task_obeying()}</p>}
      {steered && task.status === 'paused' && (
        <p className="text-fg-muted">{m.agent_task_steered_paused(steered)}</p>
      )}
      {steered && task.status === 'stopped' && (
        <p className="text-fg-muted">{m.agent_task_steered_stopped(steered)}</p>
      )}
      {steered && task.status === 'taken_over' && (
        <p className="text-fg-muted">
          {m.agent_task_steered_taken(steered)}{' '}
          <a href="/a-faire" className="font-semibold text-link underline">
            {m.agent_task_in_todo()}
          </a>
        </p>
      )}
      {live(task.status) && (
        <div className="flex flex-wrap gap-2">
          {task.status === 'paused' ? (
            <Button variant="secondary" onClick={() => send(`/tasks/${task.taskId}/resume`)}>
              {m.agent_task_resume()}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => send(`/tasks/${task.taskId}/pause`)}>
              {m.agent_task_pause()}
            </Button>
          )}
          <DialogForm
            title={m.agent_task_write()}
            ready={words.trim().length > 0}
            onSubmit={() => {
              send(`/tasks/${task.taskId}/write`, { text: words });
              setWords('');
            }}
          >
            <p className="text-body-sm text-fg-muted">{m.agent_task_write_explain()}</p>
            <label className="grid gap-1.5 text-body-sm font-semibold">
              {m.agent_task_write_label()}
              <textarea
                className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                value={words}
                maxLength={2000}
                onChange={(e) => setWords(e.target.value)}
              />
            </label>
          </DialogForm>
          <Button variant="secondary" onClick={() => send(`/tasks/${task.taskId}/take-over`)}>
            {m.agent_task_take_over()}
          </Button>
          <Button variant="secondary" onClick={() => send(`/tasks/${task.taskId}/stop`)}>
            {m.agent_task_stop()}
          </Button>
        </div>
      )}
      {task.answer && <p className="whitespace-pre-line">{task.answer}</p>}
      {task.status !== 'queued' && (
        <div>
          <HowButton taskId={task.taskId} />
        </div>
      )}
      {task.draftIds.length > 0 && (
        <a href="/a-faire" className="font-semibold text-link underline">
          {m.agent_task_drafts({ count: task.draftIds.length })}
        </a>
      )}
    </li>
  );
}

/** Giving a task: the instruction, in a drawer. */
function GiveTask({
  agentId,
  label,
  send,
}: {
  agentId: string;
  label?: string;
  send: (path: string, body?: object) => void;
}) {
  const [instruction, setInstruction] = useState('');
  return (
    <DialogForm
      title={m.agent_give_task()}
      {...(label ? { label } : {})}
      ready={instruction.trim().length > 0}
      onSubmit={() => {
        send(`/${agentId}/tasks`, { instruction });
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
  );
}

/**
 * The agents colleagues share with her (spec 066, D-044): she gives them a task, and follows what
 * she asked. They act with her rights — never with their owner's.
 */
function SharedAgents({ screen }: { screen: AgentsScreen }) {
  const { error, send } = useGesture();
  if (screen.shared.length === 0 && screen.given.length === 0) return null;
  return (
    <Panel title={m.agents_shared_title()}>
      <div className="grid gap-3">
        <p className="text-body-sm text-fg-muted">{m.agents_shared_explain()}</p>
        <ul className="grid gap-2">
          {screen.shared.map((agent) => (
            <li key={agent.agentId} className="flex flex-wrap items-center gap-2 text-body-sm">
              <Tag tone="agent">{agent.name}</Tag>
              <span className="min-w-0 flex-1">{agent.mission}</span>
              <GiveTask agentId={agent.agentId} label={m.agent_shared_give()} send={send} />
            </li>
          ))}
        </ul>
        {screen.given.length > 0 && (
          <>
            <h3 className="text-body-sm font-semibold">{m.agents_shared_given()}</h3>
            <ul className="grid gap-2">
              {screen.given.map((task) => (
                <TaskRow key={task.taskId} task={task} agentName={task.agentName} send={send} />
              ))}
            </ul>
          </>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** Who may call it (spec 066, D-044): its person alone, everyone, or one unit and those under. */
function AgentSharing({
  agent,
  units,
  send,
}: {
  agent: AgentView;
  units: { unitId: string; name: string }[];
  send: (path: string, body?: object) => void;
}) {
  const value = agent.visibility === 'private' ? 'private' : (agent.sharedWith[0] ?? 'everyone');
  return (
    <div className="grid gap-1 sm:max-w-md">
      <Select
        label={m.agent_visibility()}
        value={value}
        onChange={(e) =>
          send(`/${agent.agentId}/sharing`, {
            visibility: e.target.value === 'private' ? 'private' : 'shared',
            sharedWith:
              e.target.value === 'private' || e.target.value === 'everyone' ? [] : [e.target.value],
          })
        }
      >
        <option value="private">{m.agent_visibility_private()}</option>
        <option value="everyone">{m.agent_visibility_everyone()}</option>
        {units.map((unit) => (
          <option key={unit.unitId} value={unit.unitId}>
            {m.agent_visibility_unit({ unit: unit.name })}
          </option>
        ))}
      </Select>
      <p className="text-body-sm text-fg-muted">{m.agent_visibility_explain()}</p>
    </div>
  );
}

/** The tasks given to the agent (spec 036): a new one, the latest with their answers. */
function AgentTasks({
  agent,
  send,
}: {
  agent: AgentView;
  send: (path: string, body?: object) => void;
}) {
  const tasks = agent.tasks ?? [];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body-sm font-semibold">{m.agent_tasks()}</h3>
        {agent.status === 'active' && <GiveTask agentId={agent.agentId} send={send} />}
      </div>
      {tasks.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{m.agent_no_task()}</p>
      ) : (
        <ul className="grid gap-2">
          {tasks.map((task) => (
            <TaskRow key={task.taskId} task={task} send={send} />
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
  // Its dry run (spec 067): what it would signal today. « Créer » waits for it.
  const [dryRun, setDryRun] = useState<DryRunFinding[] | null>(null);
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
              setDryRun(null);
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
                setDryRun(null);
                void understandAgent({ data: { sentence } })
                  .then(async (answer) => {
                    if (!answer.ok || !answer.proposal) {
                      return setNotice({ ok: false, text: refusal(answer.error) });
                    }
                    setProposal(answer.proposal);
                    const tried = await dryRunAgent({ data: answer.proposal });
                    if (tried.ok) setDryRun(tried.findings);
                    else setNotice({ ok: false, text: refusal(tried.error) });
                  })
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
            <div className="grid gap-1 border-t border-line pt-2">
              <p className="text-body-sm font-semibold">{m.agent_dry_run()}</p>
              {dryRun === null ? (
                <p className="text-body-sm text-fg-muted">{m.agent_dry_run_running()}</p>
              ) : dryRun.length === 0 ? (
                <p className="text-body-sm">{m.agent_dry_run_none()}</p>
              ) : (
                <>
                  <p className="text-body-sm">
                    {m.agent_dry_run_found({ count: String(dryRun.length) })}
                  </p>
                  <ul className="grid gap-1">
                    {dryRun.slice(0, 8).map((finding, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-body-sm">
                        <Tag tone="verify">{signalLabel(finding.kind)}</Tag>
                        <span>{finding.subject}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="text-body-sm text-fg-muted">{m.agent_dry_run_explain()}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || dryRun === null}
                onClick={() => {
                  setBusy(true);
                  void createAgentAndRun({ data: proposal })
                    .then(async (answer) => {
                      if (!answer.ok) return setNotice({ ok: false, text: refusal(answer.error) });
                      setNotice({
                        ok: true,
                        text: m.agent_created_ran({ count: String(answer.raised) }),
                      });
                      setProposal(null);
                      setDryRun(null);
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

function AgentCard({
  agent,
  unitName,
  units,
  hers,
}: {
  agent: AgentView;
  unitName: Map<string, string>;
  units: { unitId: string; name: string }[];
  /** It acts for the reader: she alone opens it to colleagues. */
  hers: boolean;
}) {
  const { error, send } = useGesture();
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <Panel title={agent.name}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="agent">{m.agent_level({ level: String(agent.autonomyMax) })}</Tag>
          <Tag tone={agent.visibility === 'shared' ? 'info' : 'neutral'}>
            {agent.visibility === 'shared' ? m.agent_shared_tag() : m.agent_private_tag()}
          </Tag>
          {agent.watches.map((w) => (
            <Tag key={w}>{watchLabel(w)}</Tag>
          ))}
        </div>
        <AgentStateLine state={agent.state} />
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
        {hers && <AgentSharing agent={agent} units={units} send={send} />}
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
          <AgentCard
            key={agent.agentId}
            agent={agent}
            unitName={unitName}
            units={screen.chart.units}
            hers={agent.actsFor === screen.me}
          />
        ))
      )}
      <SharedAgents screen={screen} />
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
