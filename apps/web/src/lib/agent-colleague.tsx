import { Button, CanvasIcon, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { changeAgents } from '@/lib/agents';
import { refusal } from '@/lib/forms';
import {
  answerRequest,
  fetchAgentsScreen,
  routineNow,
  setAgentJob,
  type AgentRequest,
  type AgentSide,
  type TakeOnLevel,
} from '@/lib/threads';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// An agent is a colleague (spec 099, FR-013 to FR-017; canvas v6.2, « Les agents »): what it asks
// under its answers — « Autoriser une fois », « Toujours… », « Refuser », expiring when its routine
// asked —, its routine above its thread, its job description at work beside it, and in the top bar
// how many of her agents work and wait for her.

const hour = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
const dayWord = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );

// --- What it asks ---------------------------------------------------------------------------------

function RequestCard({ request }: { request: AgentRequest }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const open = request.status === 'prepared' && !request.expired;
  const answer = async (how: 'once' | 'always' | 'refuse') => {
    setBusy(true);
    setNote(null);
    const done = await answerRequest({ data: { draftId: request.draftId, how } });
    setBusy(false);
    if (!done.ok) return setNote(refusal(done.error));
    await router.invalidate();
  };
  const fields = Object.entries(request.values).filter(([, v]) => v !== null && v !== '');
  return (
    <section
      aria-label={request.description || request.capability}
      className="mt-2 grid max-w-[620px] gap-2 rounded-[8px] border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CanvasIcon name="decide" size={15} />
        <strong className="text-[13.5px]">{request.description || request.capability}</strong>
        {request.status !== 'prepared' && (
          <Tag tone={request.status === 'validated' ? 'validated' : 'neutral'}>
            {request.status === 'validated' ? m.colleague_allowed() : m.colleague_refused()}
          </Tag>
        )}
      </div>
      {fields.length > 0 && (
        <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
          {fields.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-fg-muted">{key}</dt>
              <dd className="m-0 truncate">{request.display[key] ?? String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {open && (
        <span className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => void answer('once')}>
            {m.colleague_once()}
          </Button>
          {request.always ? (
            <Button variant="secondary" disabled={busy} onClick={() => void answer('always')}>
              {m.colleague_always()}
            </Button>
          ) : (
            <span className="text-[12px] text-fg-muted">{m.colleague_never_sign()}</span>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => void answer('refuse')}>
            {m.colleague_refuse()}
          </Button>
        </span>
      )}
      {request.expiresAt && request.status === 'prepared' && (
        <p className="m-0 text-[12px] text-fg-muted">
          {request.expired
            ? m.colleague_expired()
            : m.colleague_expires({ time: hour(request.expiresAt) })}
        </p>
      )}
      {note && <p className="m-0 text-body-sm text-state-error-fg">{note}</p>}
    </section>
  );
}

/** What an agent asks under one of its answers. */
export function Requests({ list }: { list: AgentRequest[] }) {
  return (
    <>
      {list.map((request) => (
        <RequestCard key={request.draftId} request={request} />
      ))}
    </>
  );
}

// --- Its routine ----------------------------------------------------------------------------------

/** Above its thread: its routine, when it runs next, and « Essayer maintenant ». */
export function RoutineBanner({ agent }: { agent: AgentSide }) {
  const router = useRouter();
  if (!agent.routine) return null;
  const when = (
    agent.routine.cadence === 'daily' ? m.colleague_routine_daily : m.colleague_routine_weekdays
  )({ time: agent.routine.time });
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[12.5px]">
      <CanvasIcon name="clock" size={14} />
      <span className="min-w-0 flex-1 truncate">
        {m.colleague_routine({ when, instruction: agent.routine.instruction })}
      </span>
      {agent.nextRoutineAt && (
        <span className="text-fg-muted">
          {m.colleague_routine_next({
            when: `${dayWord(agent.nextRoutineAt)} ${hour(agent.nextRoutineAt)}`,
          })}
        </span>
      )}
      {agent.mine && (
        <Button
          variant="secondary"
          onClick={() =>
            void routineNow({ data: { agentId: agent.agentId } }).then(() => router.invalidate())
          }
        >
          {m.colleague_try_now()}
        </Button>
      )}
    </div>
  );
}

/** Its state in a word, as the agents' list says it, and the tag's tone when it is worth a look. */
function stateOf(agent: AgentSide): { word: string; tone?: 'agent' | 'verify' | 'validated' } {
  if (agent.work === 'needs') return { word: m.colleague_needs(), tone: 'verify' };
  if (agent.work === 'working') return { word: m.colleague_working(), tone: 'agent' };
  if (agent.work === 'finished') return { word: m.colleague_finished(), tone: 'validated' };
  return { word: m.colleague_idle() };
}

/** In its head, as on the canvas: its state when it is worth a look, and its settings. */
export function AgentHead({ agent }: { agent: AgentSide }) {
  const state = stateOf(agent);
  return (
    <>
      {state.tone && <Tag tone={state.tone}>{state.word}</Tag>}
      {agent.mine && (
        <a
          href={`/mes-agents/reglages#${agent.agentId}`}
          className="inline-flex h-(--control-height) items-center gap-1.5 rounded-control border border-line-control px-2.5 text-body-sm font-semibold text-fg no-underline hover:bg-surface-hover"
        >
          <CanvasIcon name="gear" size={13} />
          <span className="max-[520px]:sr-only">{m.colleague_settings_short()}</span>
        </a>
      )}
    </>
  );
}

/** In its head: pause it, or set it to work again. */
export function PauseAgent({ agent }: { agent: AgentSide }) {
  const router = useRouter();
  if (!agent.mine) return null;
  const paused = agent.status === 'paused';
  return (
    <Button
      variant="secondary"
      onClick={() =>
        void changeAgents({
          data: {
            path: `/${agent.agentId}/status`,
            body: { status: paused ? 'active' : 'paused' },
            key: crypto.randomUUID(),
          },
        }).then(() => router.invalidate())
      }
    >
      <CanvasIcon name={paused ? 'play' : 'pause'} size={13} />
      <span className="max-[520px]:sr-only">
        {paused ? m.colleague_resume() : m.colleague_pause()}
      </span>
    </Button>
  );
}

// --- Its job description at work ------------------------------------------------------------------

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="m-0 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-fit gap-0.5 rounded-[6px] border border-line-control bg-surface-control p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className="h-[24px] rounded-[4px] px-2 text-[12px] font-semibold text-fg-soft aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-sm disabled:opacity-60"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** How it last proved itself, in words (spec 106). */
const proofWords = {
  waiting: m.colleague_proof_waiting,
  passed: m.colleague_proof_passed,
  failed: m.colleague_proof_failed,
  unavailable: m.colleague_proof_unavailable,
};

/** Its sources of tools, in words: what its job description may draw on (spec 104). */
const SOURCES: [string, () => string][] = [
  ['kete', m.colleague_source_kete],
  ['knowledge', m.colleague_source_knowledge],
  ['team_data', m.colleague_source_team_data],
  ['forms', m.colleague_source_forms],
  ['documents', m.colleague_source_documents],
  ['dashboards', m.colleague_source_dashboards],
];

/** Beside its thread: its state, what it may do, what it takes on, its computer, its return. */
export function AgentSidePanel({ agent }: { agent: AgentSide }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [covers, setCovers] = useState(agent.covers.join(', '));
  const [routine, setRoutine] = useState({
    time: agent.routine?.time ?? '07:30',
    cadence: agent.routine?.cadence ?? 'weekdays',
    instruction: agent.routine?.instruction ?? '',
  });
  const job = (body: Record<string, unknown>) =>
    void setAgentJob({ data: { agentId: agent.agentId, ...body } }).then(async (answer) => {
      if (!answer.ok) return setNote(refusal(answer.error));
      setNote(null);
      await router.invalidate();
    });
  const level = (permission: string, value: number) =>
    void changeAgents({
      data: {
        path: `/${agent.agentId}/autonomy`,
        body: { permission, level: value },
        key: crypto.randomUUID(),
      },
    }).then(async (answer) => {
      if (!answer.ok) return setNote(refusal(answer.error));
      await router.invalidate();
    });
  // While she is away (spec 108): she lets it act for her with her token, or takes it back.
  const away = (on: boolean) =>
    void changeAgents({
      data: { path: `/${agent.agentId}/away`, body: { away: on }, key: crypto.randomUUID() },
    }).then(async (answer) => {
      if (!answer.ok) return setNote(refusal(answer.error));
      setNote(null);
      await router.invalidate();
    });
  const sourceWords: [string, () => string][] = [
    ...SOURCES,
    ...agent.apps.map((app): [string, () => string] => [app.product, () => app.name]),
  ];
  const takeOptions: { value: TakeOnLevel; label: string }[] = [
    { value: 'never', label: m.colleague_never() },
    { value: 'proposes', label: m.colleague_proposes() },
    { value: 'alone', label: m.colleague_alone() },
  ];
  const stateWord = stateOf(agent).word;
  return (
    <>
      {agent.person && (
        <p className="m-0 flex items-center gap-2 text-[12.5px] text-fg-soft">
          <CanvasIcon name="people" size={13} />
          {agent.mine ? m.colleague_delegate_of({ name: agent.person.name }) : m.colleague_shared()}
        </p>
      )}
      {agent.trialUntil && Date.parse(agent.trialUntil) > Date.now() && (
        <Tag tone="verify">{m.colleague_trial({ day: dayWord(agent.trialUntil) })}</Tag>
      )}
      <Block title={m.colleague_its_state()}>
        <dl className="m-0 grid grid-cols-2 gap-1 text-[12.5px]">
          <dt className="text-fg-muted">{m.colleague_now()}</dt>
          <dd className="m-0">{stateWord}</dd>
          <dt className="text-fg-muted">{m.colleague_this_month()}</dt>
          <dd className="m-0">
            {m.colleague_month_line({
              done: String(agent.month.done),
              asked: String(agent.month.asked),
            })}
          </dd>
        </dl>
      </Block>
      {agent.permissions.length > 0 && (
        <Block title={m.colleague_can_do()}>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {agent.permissions.map((p) => (
              <li key={p.permission} className="grid gap-1">
                <span className="font-mono text-[12px]">{p.permission}</span>
                <Segmented
                  label={p.permission}
                  value={String(p.level) as '1' | '2' | '3'}
                  disabled={!agent.mine}
                  options={[
                    { value: '1' as const, label: m.colleague_level_1() },
                    { value: '2' as const, label: m.colleague_level_2() },
                    ...(agent.autonomyMax >= 3
                      ? [{ value: '3' as const, label: m.colleague_level_3() }]
                      : []),
                  ]}
                  onChange={(value) => level(p.permission, Number(value))}
                />
              </li>
            ))}
          </ul>
          {agent.person && (
            <p className="m-0 text-[12px] text-fg-muted">
              {m.colleague_never_more({ name: agent.person.name })}
            </p>
          )}
        </Block>
      )}
      <Block title={m.colleague_take_on()}>
        {(
          [
            ['described', m.colleague_take_described()],
            ['other', m.colleague_take_other()],
            ['mention', m.colleague_take_mention()],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="grid gap-1">
            <span className="text-[12.5px]">{label}</span>
            <Segmented
              label={label}
              value={agent.takeOn[key]}
              options={takeOptions}
              disabled={!agent.mine}
              onChange={(value) => job({ takeOn: { [key]: value } })}
            />
          </div>
        ))}
        <label className="grid gap-1 text-[12.5px]">
          {m.colleague_covers()}
          <input
            value={covers}
            disabled={!agent.mine}
            onChange={(event) => setCovers(event.target.value)}
            onBlur={() =>
              job({
                covers: covers
                  .split(',')
                  .map((w) => w.trim())
                  .filter((w) => w.length >= 2),
              })
            }
            placeholder={m.colleague_covers_hint()}
            className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
          />
        </label>
        <p className="m-0 text-[12px] text-fg-muted">{m.colleague_take_hint()}</p>
      </Block>
      <Block title={m.colleague_sources()}>
        <ul aria-label={m.colleague_sources()} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {sourceWords.map(([source, word]) => {
            const on = agent.sources.includes(source);
            return (
              <li key={source}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={!agent.mine || (on && agent.sources.length === 1)}
                  onClick={() =>
                    job({
                      sources: on
                        ? agent.sources.filter((s) => s !== source)
                        : [...agent.sources, source],
                    })
                  }
                  className="h-[26px] rounded-full border border-line-control px-2.5 text-[12px] font-semibold text-fg-soft aria-pressed:bg-surface-selected aria-pressed:text-fg disabled:opacity-60"
                >
                  {word()}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="m-0 text-[12px] text-fg-muted">{m.colleague_sources_hint()}</p>
      </Block>
      <Block title={m.colleague_away()}>
        <p className="m-0 text-[12.5px]">
          {agent.away.since
            ? m.colleague_away_on({ day: dayWord(agent.away.since) })
            : m.colleague_away_off()}
        </p>
        {agent.mine && agent.away.possible && (
          <Button variant="secondary" onClick={() => away(!agent.away.since)}>
            {agent.away.since ? m.colleague_away_take() : m.colleague_away_give()}
          </Button>
        )}
        <p className="m-0 text-[12px] text-fg-muted">{m.colleague_away_hint()}</p>
      </Block>
      <Block title={m.colleague_budget()}>
        <p className="m-0 text-[12.5px]">
          {agent.budget.monthlyTokens === null
            ? m.colleague_budget_none({ spent: agent.budget.spentTokens.toLocaleString() })
            : m.colleague_budget_of({
                spent: agent.budget.spentTokens.toLocaleString(),
                limit: agent.budget.monthlyTokens.toLocaleString(),
              })}
        </p>
      </Block>
      {agent.proof && (
        <Block title={m.colleague_proof()}>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px]">
            <Tag
              tone={
                agent.proof.status === 'passed'
                  ? 'validated'
                  : agent.proof.status === 'failed'
                    ? 'error'
                    : 'neutral'
              }
            >
              {proofWords[agent.proof.status]()}
            </Tag>
            {agent.proof.score !== null &&
              m.colleague_proof_score({
                score: String(Math.round(agent.proof.score * 100)),
                cases: String(agent.proof.cases ?? 0),
              })}
          </p>
          {agent.proof.failures.length > 0 && (
            <ul className="m-0 grid list-none gap-1 p-0 text-[12px] text-fg-muted">
              {agent.proof.failures.map((f) => (
                <li key={f.name}>
                  {f.name} — {f.failures.join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}
      <Block title={m.colleague_computer()}>
        <p className="m-0 text-[12.5px]">
          {agent.computerMinutes === null
            ? m.colleague_computer_off()
            : m.colleague_computer_on({
                used: String(agent.computerUsed),
                minutes: String(agent.computerMinutes),
              })}
        </p>
        {agent.mine && (
          <Button
            variant="secondary"
            onClick={() => job({ computerMinutes: agent.computerMinutes === null ? 60 : null })}
          >
            {agent.computerMinutes === null
              ? m.colleague_computer_give()
              : m.colleague_computer_take()}
          </Button>
        )}
      </Block>
      <Block title={m.colleague_returns()}>
        <Segmented
          label={m.colleague_returns()}
          value={agent.returnTo}
          disabled={!agent.mine}
          options={[
            { value: 'giver' as const, label: m.colleague_returns_giver() },
            { value: 'owner' as const, label: m.colleague_returns_owner() },
          ]}
          onChange={(value) => job({ returnTo: value })}
        />
        <p className="m-0 text-[12px] text-fg-muted">{m.colleague_returns_hint()}</p>
      </Block>
      <Block title={m.colleague_when()}>
        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-1 text-[12.5px]">
          <dt>{m.colleague_when_thread()}</dt>
          <dd className="m-0 text-fg-muted">✓</dd>
          <dt>{m.colleague_when_mention()}</dt>
          <dd className="m-0 text-fg-muted">{agent.takeOn.mention === 'never' ? '—' : '✓'}</dd>
          {agent.follows.map((f) => (
            <Fragment key={`${f.type}-${f.objectKind ?? ''}-${f.state ?? ''}`}>
              <dt>
                {m.colleague_when_event({
                  what: [f.type, f.objectKind, f.state].filter(Boolean).join(' · '),
                })}
              </dt>
              <dd className="m-0 text-fg-muted">✓</dd>
            </Fragment>
          ))}
          <dt>{m.colleague_when_watch()}</dt>
          <dd className="m-0 text-fg-muted">
            {m.colleague_when_every({ minutes: String(agent.wakeEveryMinutes) })}
          </dd>
        </dl>
        {agent.mine && (
          <form
            className="grid gap-1.5 rounded-[6px] bg-bg p-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (routine.instruction.trim().length < 2) return;
              job({ routine });
            }}
          >
            <span className="text-[12.5px] font-semibold">{m.colleague_routine_set()}</span>
            <span className="flex gap-1.5">
              <select
                aria-label={m.colleague_routine_set()}
                value={routine.cadence}
                onChange={(event) =>
                  setRoutine((r) => ({ ...r, cadence: event.target.value as 'daily' | 'weekdays' }))
                }
                className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
              >
                <option value="weekdays">{m.colleague_cadence_weekdays()}</option>
                <option value="daily">{m.colleague_cadence_daily()}</option>
              </select>
              <input
                type="time"
                aria-label={m.colleague_routine_set()}
                value={routine.time}
                onChange={(event) => setRoutine((r) => ({ ...r, time: event.target.value }))}
                className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
              />
            </span>
            <input
              aria-label={m.colleague_routine_what()}
              placeholder={m.colleague_routine_what()}
              value={routine.instruction}
              onChange={(event) => setRoutine((r) => ({ ...r, instruction: event.target.value }))}
              className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
            />
            <span className="flex flex-wrap gap-1.5">
              <Button type="submit">{m.colleague_routine_save()}</Button>
              {agent.routine && (
                <Button type="button" variant="ghost" onClick={() => job({ routine: null })}>
                  {m.colleague_routine_remove()}
                </Button>
              )}
            </span>
          </form>
        )}
      </Block>
      <Block title={m.colleague_budget()}>
        <p className="m-0 text-[12.5px]">
          {m.colleague_budget_line({ count: String(agent.draftBudget) })}
        </p>
      </Block>
      {note && <p className="m-0 text-body-sm text-state-error-fg">{note}</p>}
      <a
        href={`/mes-agents/reglages#${agent.agentId}`}
        className="text-body-sm font-semibold text-link"
      >
        {m.colleague_settings()}
      </a>
    </>
  );
}

// --- In the top bar -------------------------------------------------------------------------------

/** « 1 travaille · 1 attend vous »: her agents at a glance, to their screen. */
export function AgentsPill() {
  const [counts, setCounts] = useState<{ working: number; needs: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void fetchAgentsScreen()
        .then((screen) => alive && setCounts({ working: screen.working, needs: screen.needs }))
        .catch(() => undefined);
    read();
    const timer = setInterval(read, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!counts || counts.working + counts.needs === 0) return null;
  return (
    <a
      href="/mes-agents"
      className="inline-flex h-[28px] items-center gap-1.5 rounded-full border border-line-control px-2.5 text-[12px] font-semibold text-fg-soft hover:bg-surface-hover max-[860px]:hidden"
    >
      <span aria-hidden="true" className="size-2 rounded-full border border-fg-soft" />
      {m.colleague_pill({ working: String(counts.working), needs: String(counts.needs) })}
      {counts.needs > 0 && (
        <span aria-hidden="true" className="size-2 rounded-full bg-state-verify" />
      )}
    </a>
  );
}
