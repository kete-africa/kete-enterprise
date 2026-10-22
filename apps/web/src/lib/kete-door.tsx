import { AgentRun, type ConversationWords } from '@kete/conversation';
import { Button, CanvasIcon, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { refusal } from '@/lib/forms';
import {
  confirmGestures,
  decidePolicy,
  declineProposal,
  fetchTurn,
  inviteToKete,
  stopTurn,
  type AgentWorkState,
  type GestureSet,
  type Proposal,
  type Turn,
} from '@/lib/threads';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// Kete's door in a thread (spec 099, FR-007 to FR-011; canvas v6.2, cases A and B and « Fil
// Kete »): its turn at work with « Arrêter », what it proposes under its answer — a set of gestures
// she confirms in one tap or corrects, a rule become a policy simulated over thirty days, the parts
// handed to her agents —, and her thread « Kete »'s side: what is handed now, what it never does.

type Person = { id: string; name: string };

const dayWord = (day: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${day}T12:00:00Z`),
  );

const priorityWord: Record<string, () => string> = {
  urgent: m.threads_priority_urgent,
  high: m.threads_priority_high,
  normal: m.threads_priority_normal,
  low: m.threads_priority_low,
};

const familyWord: Record<string, () => string> = {
  commits: m.policy_family_commits,
  speaks: m.policy_family_speaks,
  spending: m.policy_family_spending,
  deputies: m.policy_family_deputies,
  retention: m.policy_family_retention,
  consent: m.policy_family_consent,
};

const agentStateWord: Record<AgentWorkState, () => string> = {
  needs: m.threads_state_needs,
  working: m.threads_state_working,
  finished: m.threads_state_finished,
  idle: m.threads_state_idle,
};
const agentStateTone: Record<AgentWorkState, 'verify' | 'info' | 'validated' | 'neutral'> = {
  needs: 'verify',
  working: 'info',
  finished: 'validated',
  idle: 'neutral',
};

function Card({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="mt-2 grid max-w-[620px] gap-2 rounded-[8px] border border-line bg-surface p-3"
    >
      {children}
    </section>
  );
}

function CardHead({
  icon,
  title,
  tag,
  side,
}: {
  icon: 'layers' | 'shield' | 'bot';
  title: string;
  tag?: ReactNode;
  side?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CanvasIcon name={icon} size={15} />
      <strong className="text-[13.5px]">{title}</strong>
      {tag}
      {side && <span className="ml-auto text-[12px] text-fg-muted">{side}</span>}
    </div>
  );
}

// --- A set of gestures ----------------------------------------------------------------------------

type Edit = { holder?: string; due?: string | null; priority?: string };

function GesturesCard({
  proposal,
  names,
  people,
}: {
  proposal: Extract<Proposal, { kind: 'gestures' }>;
  names: Record<string, string>;
  people: Person[];
}) {
  const router = useRouter();
  const set: GestureSet = proposal.body;
  const count = set.holdings.length + set.dates.length + set.routines.length;
  const [kept, setKept] = useState<boolean[]>(() => Array.from({ length: count }, () => true));
  const [correcting, setCorrecting] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const open = proposal.state === 'proposed';
  const chosen = kept.filter(Boolean).length;
  const nameOf = (id: string) => names[id] ?? people.find((p) => p.id === id)?.name ?? id;
  const edit = (index: number, change: Edit) =>
    setEdits((all) => ({ ...all, [String(index)]: { ...all[String(index)], ...change } }));

  const decide = async (yes: boolean) => {
    setBusy(true);
    setNote(null);
    const answer = yes
      ? await confirmGestures({
          data: {
            proposalId: proposal.proposalId,
            ...(chosen < count ? { keep: kept.flatMap((k, i) => (k ? [i] : [])) } : {}),
            edits,
          },
        })
      : await declineProposal({ data: { proposalId: proposal.proposalId } });
    setBusy(false);
    if (!answer.ok) return setNote(refusal(answer.error));
    await router.invalidate();
  };

  let index = -1;
  const row = (title: string, detail: ReactNode, source: string | null, editor?: ReactNode) => {
    index += 1;
    const at = index;
    return (
      <li key={at} className="flex gap-2.5 border-t border-line py-2 first:border-t-0">
        <input
          type="checkbox"
          aria-label={title}
          checked={kept[at] ?? true}
          disabled={!open || busy}
          onChange={() => setKept((all) => all.map((k, i) => (i === at ? !k : k)))}
          className="mt-1 size-4 shrink-0 accent-[var(--color-action)]"
        />
        <div className="grid min-w-0 gap-0.5">
          <strong className="text-[13px]">{title}</strong>
          <span className="text-[12.5px] text-fg-soft">{detail}</span>
          {source && <span className="text-[12px] text-fg-muted italic">— {source}</span>}
          {correcting && editor}
        </div>
      </li>
    );
  };

  return (
    <Card label={m.door_gestures({ count: String(count) })}>
      <CardHead
        icon="layers"
        title={m.door_gestures({ count: String(count) })}
        tag={<Tag tone="neutral">{m.door_draft()}</Tag>}
        side={open ? m.door_nothing_before() : undefined}
      />
      {set.object && (
        <a
          href={set.object.thread ? `/fils?fil=${set.object.thread}` : '#'}
          className="inline-flex w-fit items-center gap-1 rounded-[5px] bg-state-info-surface px-1.5 text-[12.5px] font-semibold text-state-info-fg"
        >
          <CanvasIcon name="hash" size={12} />
          {m.door_attached({ title: set.object.title })}
        </a>
      )}
      <ul className="m-0 grid list-none p-0">
        {set.holdings.map((h, i) => {
          const e = edits[String(i)] ?? {};
          const due = e.due === undefined ? h.due : e.due;
          return row(
            `${m.door_holding()} · ${h.what}`,
            [
              nameOf(e.holder ?? h.holder),
              due ? m.door_for_day({ day: dayWord(due) }) : null,
              priorityWord[e.priority ?? h.priority]?.(),
              m.door_return_to({ name: nameOf(h.returnTo) }),
            ]
              .filter(Boolean)
              .join(' · '),
            h.source,
            <span className="mt-1 flex flex-wrap gap-1.5">
              <select
                aria-label={m.door_who()}
                value={e.holder ?? h.holder}
                onChange={(event) => edit(i, { holder: event.target.value })}
                className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
              >
                {[
                  { id: h.holder, name: nameOf(h.holder) },
                  ...people.filter((p) => p.id !== h.holder),
                ].map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                aria-label={m.door_when()}
                value={due ?? ''}
                onChange={(event) => edit(i, { due: event.target.value || null })}
                className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
              />
              <select
                aria-label={m.door_priority()}
                value={e.priority ?? h.priority}
                onChange={(event) => edit(i, { priority: event.target.value })}
                className="h-[28px] rounded-control border border-line-control bg-control px-2 text-[12.5px]"
              >
                {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                  <option key={p} value={p}>
                    {priorityWord[p]?.()}
                  </option>
                ))}
              </select>
            </span>,
          );
        })}
        {set.dates.map((d) =>
          row(`${m.door_date()} · ${d.label}`, `${dayWord(d.day)} · ${m.door_in_plan()}`, d.source),
        )}
        {set.routines.map((r) =>
          row(
            `${m.door_routine()} · ${r.title}`,
            (r.cadence === 'daily'
              ? m.door_daily
              : r.cadence === 'weekdays'
                ? m.door_weekdays
                : m.door_weekly)({ time: r.time }),
            r.source,
          ),
        )}
      </ul>
      {open ? (
        <span className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || chosen === 0} onClick={() => void decide(true)}>
            {chosen === count
              ? m.door_yes({ count: String(count) })
              : m.door_yes_these({ count: String(chosen) })}
          </Button>
          <Button
            variant="secondary"
            aria-pressed={correcting}
            disabled={busy}
            onClick={() => setCorrecting((c) => !c)}
          >
            {m.door_correct()}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
            {m.door_no()}
          </Button>
        </span>
      ) : (
        <Tag tone={proposal.state === 'confirmed' ? 'validated' : 'neutral'}>
          {proposal.state === 'confirmed'
            ? m.door_done({
                count: String(
                  Object.values(proposal.made).reduce<number>(
                    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
                    0,
                  ),
                ),
              })
            : m.door_declined()}
        </Tag>
      )}
      {note && <p className="m-0 text-body-sm text-state-error-fg">{note}</p>}
    </Card>
  );
}

// --- A rule become a policy -----------------------------------------------------------------------

function PolicyCard({ proposal }: { proposal: Extract<Proposal, { kind: 'policy' }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { policy, simulation } = proposal.body;
  const open = proposal.state === 'proposed';
  const family = proposal.body.template.split('.')[0] ?? '';
  const title = m.door_policy_title({
    family: familyWord[family]?.() ?? proposal.body.template,
  });
  const decide = async (how: 'adopt' | 'trial' | 'no') => {
    setBusy(true);
    setNote(null);
    const answer =
      how === 'no'
        ? await declineProposal({ data: { proposalId: proposal.proposalId } })
        : await decidePolicy({ data: { proposalId: proposal.proposalId, how } });
    setBusy(false);
    if (!answer.ok) {
      return setNote(answer.error === 'forbidden' ? m.door_admin_only() : refusal(answer.error));
    }
    await router.invalidate();
  };
  const stat = (label: string, value: number, unit: string) => (
    <div className="grid gap-0.5 rounded-[6px] bg-bg px-2.5 py-2">
      <span className="text-[11.5px] text-fg-muted">{label}</span>
      <strong className="font-mono text-[18px] tabular-nums">{value}</strong>
      <span className="text-[11.5px] text-fg-muted">{unit}</span>
    </div>
  );
  return (
    <Card label={title}>
      <CardHead icon="shield" title={title} tag={<Tag tone="verify">{m.door_policy_tag()}</Tag>} />
      <p className="m-0 text-[13px]">
        « {policy.sentence} » <span className="text-fg-muted">{m.door_policy_for()}</span>
      </p>
      <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-state-success-surface p-2">
        {stat(m.door_policy_replayed(), simulation.replayed, m.door_policy_replayed_unit())}
        {stat(
          m.door_policy_changed(),
          simulation.changed,
          m.door_policy_by_agents({ count: String(simulation.byAgents) }),
        )}
      </div>
      {open ? (
        <span className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void decide('adopt')}>
            {m.door_adopt()}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void decide('trial')}>
            {m.door_trial()}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void decide('no')}>
            {m.door_no()}
          </Button>
        </span>
      ) : (
        <Tag tone={proposal.state === 'declined' ? 'neutral' : 'validated'}>
          {proposal.state === 'adopted'
            ? m.door_adopted()
            : proposal.state === 'trial'
              ? m.door_on_trial()
              : m.door_declined()}
        </Tag>
      )}
      {note && <p className="m-0 text-body-sm text-fg-muted">{note}</p>}
    </Card>
  );
}

// --- A part handed to an agent --------------------------------------------------------------------

function HandoverCard({ proposal }: { proposal: Extract<Proposal, { kind: 'handover' }> }) {
  const state = proposal.agent?.state ?? 'working';
  return (
    <div className="mt-2 flex max-w-[620px] flex-wrap items-center gap-2.5 rounded-[8px] border border-line bg-surface px-3 py-2">
      <span className="grid size-7 flex-none place-items-center rounded-[6px] bg-agent text-on-agent">
        <CanvasIcon name="bot" size={14} />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[13px]">
          <strong>{proposal.agent?.name ?? '—'}</strong> · {proposal.body.part}
        </span>
        {proposal.agent?.step && (
          <span className="text-[12px] text-fg-muted">{proposal.agent.step}</span>
        )}
      </span>
      <Tag tone={agentStateTone[state]}>{agentStateWord[state]()}</Tag>
      <a
        href="/mes-agents"
        className="inline-flex h-[28px] items-center rounded-control border border-line-control px-2.5 text-[12.5px] font-semibold hover:bg-surface-hover"
      >
        {m.door_open_agent()}
      </a>
    </div>
  );
}

/** What Kete proposed under one of its messages. */
export function Proposals({
  list,
  names,
  people,
}: {
  list: Proposal[];
  names: Record<string, string>;
  people: Person[];
}) {
  return (
    <>
      {list.map((proposal) =>
        proposal.kind === 'gestures' ? (
          <GesturesCard
            key={proposal.proposalId}
            proposal={proposal}
            names={names}
            people={people}
          />
        ) : proposal.kind === 'policy' ? (
          <PolicyCard key={proposal.proposalId} proposal={proposal} />
        ) : (
          <HandoverCard key={proposal.proposalId} proposal={proposal} />
        ),
      )}
    </>
  );
}

/** The page a question to Kete was asked from, through the drawer. */
export function FromPage({ page }: { page: { href: string; title: string } }) {
  return (
    <a
      href={page.href}
      className="mt-1 inline-flex w-fit items-center gap-1 rounded-[5px] bg-surface-selected px-1.5 py-0.5 text-[12px] text-fg-soft hover:text-fg"
    >
      <CanvasIcon name="ext" size={11} />
      {m.door_from_page({ title: page.title })}
    </a>
  );
}

// --- Kete's turn at work --------------------------------------------------------------------------

/**
 * Kete's turn at work, below the conversation: its steps and its words as they come, « Arrêter »
 * for whom asked it; once it ends, the thread reloads with its answer.
 */
export function TurnAtWork({
  threadId,
  turn,
  me,
  words,
}: {
  threadId: string;
  turn: Turn | { turnId: string } | null;
  me: string;
  words: ConversationWords;
}) {
  const router = useRouter();
  const [seen, setSeen] = useState<Turn | null>(turn && 'steps' in turn ? turn : null);
  const [ended, setEnded] = useState<string | null>(null);
  const turnId = turn?.turnId ?? null;
  useEffect(() => {
    if (!turnId || ended === turnId) return;
    let alive = true;
    let empty = 0;
    const timer = setInterval(() => {
      void fetchTurn({ data: { threadId } }).then((now) => {
        if (!alive) return;
        if (now && now.turnId === turnId) {
          setSeen(now);
          return;
        }
        // Its turn row may not be written yet: a few empty reads, then it has ended.
        empty += 1;
        if (now || empty > 2) {
          clearInterval(timer);
          setSeen(null);
          setEnded(turnId);
          void router.invalidate();
        }
      });
    }, 900);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [turnId, threadId, router, ended]);
  if (!turnId || ended === turnId) return null;
  const steps = seen?.steps ?? [];
  const live = seen?.live.trim()
    ? seen.live.slice(-240)
    : (steps.at(-1)?.label ?? m.door_working());
  return (
    <div
      className="flex-none border-t border-line bg-bg px-4 py-2 max-[860px]:px-2.5"
      role="status"
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg-soft">
        <span className="grid size-6 place-items-center rounded-[6px] bg-agent text-on-agent">
          <CanvasIcon name="spark" size={12} />
        </span>
        Kete
      </div>
      <AgentRun
        words={words}
        run={{
          title: m.door_working(),
          meta: m.door_working_meta({ steps: String(steps.length) }),
          steps,
          live,
          ...(!seen || seen.askedBy === me
            ? { onStop: () => void stopTurn({ data: { turnId } }).then(() => router.invalidate()) }
            : {}),
        }}
      />
    </div>
  );
}

// --- Her thread « Kete » --------------------------------------------------------------------------

export function InviteToKete({
  threadId,
  people,
  me,
}: {
  threadId: string;
  people: Person[];
  me: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState('');
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="relative">
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CanvasIcon name="people" size={13} />
        <span className="max-[520px]:sr-only">{m.door_invite()}</span>
      </Button>
      {open && (
        <span className="absolute top-full right-0 z-20 mt-1 grid w-[260px] gap-2 rounded-[8px] border border-line bg-surface p-2.5 shadow-lg">
          <span className="text-[12px] text-fg-muted">{m.door_invite_hint()}</span>
          <select
            aria-label={m.door_invite()}
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="h-(--control-height) rounded-control border border-line-control bg-control px-2 text-body-sm"
          >
            <option value="">—</option>
            {people
              .filter((p) => p.id !== me)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <Button
            disabled={!chosen}
            onClick={() =>
              void inviteToKete({ data: { threadId, people: [chosen] } }).then((answer) => {
                if (!answer.ok) return setNote(refusal(answer.error));
                window.location.href = `/fils?fil=${threadId}`;
              })
            }
          >
            {m.door_invite_send()}
          </Button>
          {note && <span className="text-body-sm text-state-error-fg">{note}</span>}
        </span>
      )}
    </span>
  );
}

/** Beside her thread « Kete »: what her agents work for her now, and what Kete never does. */
export function KeteSide({
  handed,
}: {
  handed: { agentId: string; name: string; part: string; state: AgentWorkState }[];
}) {
  const block = (title: string, children: ReactNode, side?: ReactNode) => (
    <section className="grid gap-1.5">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {title}
        {side}
      </h3>
      {children}
    </section>
  );
  return (
    <>
      {block(
        m.door_handed_now(),
        handed.length === 0 ? (
          <p className="m-0 text-body-sm text-fg-muted">{m.door_handed_none()}</p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {handed.map((h, i) => (
              <li
                key={`${h.agentId}-${i}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
              >
                <span className="grid size-6 place-items-center rounded-[5px] bg-agent text-on-agent">
                  <CanvasIcon name="bot" size={12} />
                </span>
                <span className="grid min-w-0">
                  <strong className="truncate text-[13px]">{h.name}</strong>
                  <span className="truncate text-[12px] text-fg-muted">{h.part}</span>
                </span>
                <Tag tone={agentStateTone[h.state]}>{agentStateWord[h.state]()}</Tag>
              </li>
            ))}
          </ul>
        ),
        handed.length > 0 ? (
          <span className="rounded-full bg-surface-selected px-1.5 font-mono">{handed.length}</span>
        ) : undefined,
      )}
      {block(m.door_reads(), <p className="m-0 text-body-sm">{m.door_reads_list()}</p>)}
      {block(m.door_never(), <p className="m-0 text-body-sm">{m.door_never_text()}</p>)}
      {block(m.door_drawer(), <p className="m-0 text-body-sm">{m.door_drawer_text()}</p>)}
      <a href="/assistant?avant=1" className="text-body-sm font-semibold text-link">
        {m.door_before()}
      </a>
    </>
  );
}
