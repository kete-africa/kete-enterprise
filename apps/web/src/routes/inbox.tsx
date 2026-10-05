import { Button, EmptyState, Icon, PageSection, Row, RowList, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { kindIcon, kindLabel, toDecide, why, dayOf } from '@/lib/day';
import { fetchInbox, changeDecisions } from '@/lib/decisions';
import { ruleLabel, statusLabel, subjectLabel } from '@/lib/decisions-view';
import { DraftCard } from '@/lib/draft-card';
import { changeAgents } from '@/lib/agents';
import { DialogForm, refusal } from '@/lib/forms';
import { fetchMeetings } from '@/lib/meetings';
import { NoteCard } from '@/lib/meetings-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchToday, type DayItem } from '@/lib/today';
import {
  analyseDecision,
  commentDecision,
  fetchDecision,
  fetchMyAgents,
  type DecisionDetail,
} from '@/lib/todo';
import { decideDraft, fetchDrafts, type DraftReview } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

const itemPattern = /^(decision|draft|app_task|form|action|note):[A-Za-z0-9_-]{4,80}$/;

export const Route = createFileRoute('/a-faire')({
  validateSearch: (search: Record<string, unknown>): { item?: string } =>
    typeof search['item'] === 'string' && itemPattern.test(search['item'])
      ? { item: search['item'] }
      : {},
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ context }) => {
    const [today, drafts, inbox, agents, meetings] = await Promise.all([
      fetchToday(),
      fetchDrafts().catch(() => ({ drafts: [] as DraftReview[] })),
      fetchInbox(),
      fetchMyAgents(),
      context.me.modules.meetings ? fetchMeetings().catch(() => null) : Promise.resolve(null),
    ]);
    return {
      items: [...today.day.filter(toDecide), ...today.day.filter((i) => !toDecide(i))],
      drafts: drafts.drafts,
      mine: inbox.mine,
      agents,
      notes: (meetings?.notes ?? []).filter((n) => n.status === 'published' && !n.readByMe),
    };
  },
  component: TodoPage,
});

const keyOf = (item: DayItem) => `${item.kind}:${item.id}`;

/** Clicks the visible control of the detail that carries this shortcut. */
function press(root: HTMLElement | null, shortcut: string) {
  const target = root?.querySelector<HTMLElement>(
    `[data-shortcut="${shortcut}"] button, button[data-shortcut="${shortcut}"], a[data-shortcut="${shortcut}"]`,
  );
  if (target && !(target as HTMLButtonElement).disabled) target.click();
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-line px-1.5 font-number text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}

/**
 * « À faire » (spec 047): what waits, to decide then to complete, beside the selected one in full —
 * a decision with its analysis, its steps and its discussion; a draft with its provenance; the
 * rest with the gesture that settles it. J and K move, A approves, R refuses, C gives to an agent.
 */
function TodoPage() {
  const { me } = Route.useRouteContext();
  const { items, drafts, mine, agents, notes } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const detail = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(
    search.item && items.some((i) => keyOf(i) === search.item)
      ? search.item
      : items[0]
        ? keyOf(items[0])
        : null,
  );
  const current = items.find((i) => keyOf(i) === selected) ?? null;
  const select = useCallback(
    (key: string) => {
      setSelected(key);
      window.history.replaceState(null, '', `/a-faire?item=${encodeURIComponent(key)}`);
    },
    [setSelected],
  );
  const move = useCallback(
    (step: number) => {
      if (items.length === 0) return;
      const index = items.findIndex((i) => keyOf(i) === selected);
      const next = items[Math.min(items.length - 1, Math.max(0, index + step))];
      if (next) select(keyOf(next));
    },
    [items, selected, select],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'j') move(1);
      else if (key === 'k') move(-1);
      else if (key === 'a' || key === 'r' || key === 'c') press(detail.current, key);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move]);
  const settled = async () => {
    await router.invalidate();
  };
  const lanes = [
    { title: m.todo_lane_decide(), items: items.filter(toDecide) },
    { title: m.todo_lane_complete(), items: items.filter((i) => !toDecide(i)) },
  ].filter((l) => l.items.length > 0);

  return (
    <AppShell me={me} current="todo">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-[28px] leading-tight font-semibold">{m.nav_todo()}</h1>
        {items.length > 0 && <Tag>{String(items.length)}</Tag>}
      </div>
      {items.length === 0 ? (
        <EmptyState title={m.todo_empty()} />
      ) : (
        <div className="grid gap-5 min-[1101px]:grid-cols-[340px_minmax(0,1fr)] min-[1101px]:items-start">
          <nav aria-label={m.nav_todo()} className="grid gap-4">
            {lanes.map((lane) => (
              <section key={lane.title} aria-label={lane.title}>
                <h2 className="mb-2 text-label-caps text-fg-muted">{lane.title}</h2>
                <ul className="grid gap-1">
                  {lane.items.map((item) => {
                    const active = keyOf(item) === selected;
                    return (
                      <li key={keyOf(item)}>
                        <button
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => select(keyOf(item))}
                          className={`grid w-full gap-1 rounded-control border-l-[3px] px-3 py-2.5 text-left ${
                            active
                              ? 'border-accent bg-surface-selected'
                              : 'border-transparent hover:bg-surface-hover'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <Tag tone={item.kind === 'draft' ? 'agent' : 'neutral'}>
                              {kindLabel(item.kind)}
                            </Tag>
                            {item.overdue ? (
                              <span className="text-body-sm text-state-error-fg">
                                {m.today_overdue()}
                              </span>
                            ) : (
                              item.dueAt && (
                                <span className="text-body-sm text-fg-muted">
                                  {dayOf(item.dueAt)}
                                </span>
                              )
                            )}
                          </span>
                          <span className="font-semibold">{item.title}</span>
                          <span className="truncate text-body-sm text-fg-muted">{why(item)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm text-fg-muted max-[760px]:hidden">
              <span>
                <Kbd>J</Kbd> <Kbd>K</Kbd> {m.todo_keys_move()}
              </span>
              <span>
                <Kbd>A</Kbd> {m.todo_keys_approve()}
              </span>
              <span>
                <Kbd>R</Kbd> {m.todo_keys_refuse()}
              </span>
              <span>
                <Kbd>C</Kbd> {m.todo_keys_give()}
              </span>
            </p>
          </nav>
          <div
            ref={detail}
            className="min-w-0 rounded-box border border-line bg-surface p-6 max-[760px]:p-4"
          >
            {current && (
              <Detail
                key={keyOf(current)}
                item={current}
                draft={drafts.find((d) => d.draftId === current.id) ?? null}
                note={notes.find((n) => n.noteId === current.id) ?? null}
                agents={me.viewedBy ? [] : agents}
                onSettled={settled}
              />
            )}
          </div>
        </div>
      )}
      {mine.length > 0 && (
        <PageSection title={m.todo_my_requests()}>
          <RowList label={m.todo_my_requests()}>
            {mine.map((r) => (
              <Row
                key={r.requestId}
                href={`/a-faire?item=decision:${r.requestId}`}
                title={r.title}
                meta={subjectLabel(r.subject, r.subjectLabel)}
                end={
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
                }
              />
            ))}
          </RowList>
        </PageSection>
      )}
    </AppShell>
  );
}

/** The selected thing in full, with what settles it. */
function Detail({
  item,
  draft,
  note,
  agents,
  onSettled,
}: {
  item: DayItem;
  draft: DraftReview | null;
  note: Parameters<typeof NoteCard>[0]['note'] | null;
  agents: { agentId: string; name: string }[];
  onSettled: () => Promise<void>;
}) {
  if (item.kind === 'decision') return <DecisionPane requestId={item.id} onSettled={onSettled} />;
  if (item.kind === 'draft' && draft) {
    return (
      <div className="grid gap-4">
        <Header item={item} />
        <DraftCard draft={draft} onDecided={() => void onSettled()} />
        <DraftKeys draftId={draft.draftId} onSettled={onSettled} />
      </div>
    );
  }
  return (
    <div className="grid gap-5">
      <Header item={item} />
      {item.kind === 'note' && note && <NoteCard note={note} publishes={false} />}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <a
          href={item.href}
          className="inline-flex h-(--control-height) items-center rounded-control bg-action px-(--control-padding) font-semibold text-on-action hover:bg-action-strong"
        >
          {item.kind === 'form' ? m.todo_fill() : m.today_open()}
        </a>
        {agents.length > 0 && <GiveToAgent item={item} agents={agents} />}
      </div>
    </div>
  );
}

function Header({ item, children }: { item: DayItem; children?: ReactNode }) {
  return (
    <header className="grid gap-2">
      <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
        <Icon name={kindIcon[item.kind]} size={16} />
        <span>{kindLabel(item.kind)}</span>
        {children}
      </p>
      <h2 className="font-heading text-[24px] leading-tight font-semibold">{item.title}</h2>
      <p className="text-body-sm text-fg-muted">{why(item)}</p>
    </header>
  );
}

/** A and R on a draft: the same gesture as its card's buttons. */
function DraftKeys({ draftId, onSettled }: { draftId: string; onSettled: () => Promise<void> }) {
  const decide = (action: 'validate' | 'refuse') =>
    void decideDraft({ data: { draftId, action } }).then(() => onSettled());
  return (
    <div hidden>
      <button type="button" data-shortcut="a" onClick={() => decide('validate')} />
      <button type="button" data-shortcut="r" onClick={() => decide('refuse')} />
    </div>
  );
}

/** C: one of her agents takes it, with her rights narrowed to its job description (spec 036). */
function GiveToAgent({
  item,
  agents,
}: {
  item: DayItem;
  agents: { agentId: string; name: string }[];
}) {
  const [agentId, setAgentId] = useState(agents[0]?.agentId ?? '');
  const [instruction, setInstruction] = useState<string>(
    m.todo_give_instruction({ title: item.title, source: item.source ?? '' }),
  );
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <span data-shortcut="c" className="contents">
      <DialogForm
        title={m.todo_give()}
        ready={Boolean(agentId && instruction.trim())}
        onSubmit={() =>
          void changeAgents({
            data: {
              path: `/${agentId}/tasks`,
              body: { instruction: instruction.trim() },
              key: crypto.randomUUID(),
            },
          }).then((answer) => setNotice(answer.ok ? m.todo_given() : refusal(answer.error)))
        }
      >
        <p className="text-body-sm text-fg-muted">{m.agent_task_explain()}</p>
        <label className="grid gap-1.5 text-body-sm font-semibold">
          {m.todo_give_agent()}
          <select
            className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-3 font-normal"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
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
      {notice && <span className="self-center text-body-sm text-fg-muted">{notice}</span>}
    </span>
  );
}

const confidenceLabel = {
  high: m.todo_confidence_high,
  medium: m.todo_confidence_medium,
  low: m.todo_confidence_low,
};
const recommendationLabel = {
  approve: m.todo_recommend_approve,
  refuse: m.todo_recommend_refuse,
  unsure: m.todo_recommend_unsure,
};

/** A decision in full: who asked, the analysis, the steps, the facts, the discussion, the gesture. */
function DecisionPane({
  requestId,
  onSettled,
}: {
  requestId: string;
  onSettled: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(
    () =>
      fetchDecision({ data: { requestId } })
        .then(setDetail)
        .catch(() => setError(refusal('not_found'))),
    [requestId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = (
    work: () => Promise<{ ok: boolean; error: string | null }>,
    after: () => Promise<unknown>,
  ) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        await after();
      })
      .finally(() => setBusy(false));
  };
  const decide = (decision: 'approve' | 'refuse') =>
    run(
      () =>
        changeDecisions({
          data: {
            path: `/requests/${requestId}/decide`,
            body: { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
            key: crypto.randomUUID(),
          },
        }),
      onSettled,
    );
  const when = useMemo(
    () => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }),
    [],
  );
  if (!detail) {
    return error ? (
      <p role="alert" className="text-state-error-fg">
        {error}
      </p>
    ) : (
      <p className="text-fg-muted">{m.todo_loading()}</p>
    );
  }
  const { request, analysis } = detail;
  const number = new Intl.NumberFormat(getLocale());
  const question = m.todo_ask_question({ title: request.title });
  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          <Tag tone="verify">{m.todo_kind_decision()}</Tag>
          <span>{subjectLabel(request.subject, request.subjectLabel)}</span>
          {detail.requesterName && <span>· {m.todo_asked_by({ name: detail.requesterName })}</span>}
        </p>
        <h2 className="font-heading text-[24px] leading-tight font-semibold">{request.title}</h2>
      </header>

      <section
        aria-label={m.todo_analysis()}
        className="grid gap-3 rounded-box border border-line bg-surface-selected p-4"
      >
        {analysis ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <Icon name="sparkle" size={18} />
              <span className="font-semibold">
                {recommendationLabel[analysis.recommendation]()}
              </span>
              <span className="text-body-sm text-fg-muted">
                {confidenceLabel[analysis.confidence]()} ·{' '}
                {m.todo_sources({
                  count: String(analysis.points.filter((p) => p.source).length),
                })}
              </span>
            </p>
            <ul className="grid list-disc gap-1.5 pl-5">
              {analysis.points.map((p, index) => (
                <li key={index}>
                  {p.text}{' '}
                  {p.source &&
                    (p.source.href ? (
                      <a
                        href={p.source.href}
                        className="inline-flex items-center gap-1 text-body-sm text-link underline decoration-dotted"
                      >
                        <Icon name="file" size={14} />
                        {p.source.title}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-body-sm text-fg-muted">
                        <Icon name="file" size={14} />
                        {p.source.title}
                      </span>
                    ))}
                </li>
              ))}
            </ul>
            <p className="flex flex-wrap gap-3 text-body-sm">
              <a
                href={`/assistant?q=${encodeURIComponent(question)}`}
                className="inline-flex items-center gap-1 font-semibold text-link"
              >
                <Icon name="sparkle" size={14} />
                {m.todo_ask_why()}
              </a>
              <button
                type="button"
                disabled={busy}
                className="text-fg-muted underline"
                onClick={() => run(() => analyseDecision({ data: { requestId } }), load)}
              >
                {m.todo_analyse_again()}
              </button>
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-body-sm text-fg-muted">{m.todo_analysis_explain()}</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => analyseDecision({ data: { requestId } }), load)}
            >
              {busy ? m.todo_analysing() : m.todo_analyse()}
            </Button>
          </div>
        )}
      </section>

      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={m.todo_steps()}>
        {request.steps.map((s) => (
          <li key={s.position} className="flex items-center gap-2 text-body-sm">
            <span
              className={`inline-flex size-6 items-center justify-center rounded-full border font-number text-[12px] ${
                s.status === 'approved'
                  ? 'border-state-success bg-state-success-surface text-state-success-fg'
                  : s.status === 'refused'
                    ? 'border-state-error bg-state-error-surface text-state-error-fg'
                    : s.position === request.currentStep
                      ? 'border-accent text-accent'
                      : 'border-line text-fg-muted'
              }`}
            >
              {s.status === 'approved' ? <Icon name="check" size={14} /> : s.position}
            </span>
            <span className={s.position === request.currentStep ? 'font-semibold' : ''}>
              {ruleLabel(s.rule)}
              {s.position === request.currentStep && detail.mayDecide ? ` · ${m.todo_you()}` : ''}
            </span>
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-body-sm">
        <dt className="text-fg-muted">{m.todo_reference()}</dt>
        <dd>{request.reference}</dd>
        {request.measure !== null && (
          <>
            <dt className="text-fg-muted">{m.todo_measure()}</dt>
            <dd className="font-number">{number.format(request.measure)}</dd>
          </>
        )}
        <dt className="text-fg-muted">{m.todo_asked_on()}</dt>
        <dd>{when.format(new Date(request.createdAt))}</dd>
        <dt className="text-fg-muted">{m.todo_status()}</dt>
        <dd>{statusLabel(request.status)}</dd>
      </dl>

      <section aria-label={m.todo_discussion()} className="grid gap-3 border-t border-line pt-4">
        <h3 className="font-semibold">{m.todo_discussion()}</h3>
        {detail.comments.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.todo_no_comment()}</p>
        ) : (
          <ul className="grid gap-3">
            {detail.comments.map((c) => (
              <li key={c.commentId} className="grid gap-0.5">
                <p className="text-body-sm">
                  <span className="font-semibold">{c.authorName}</span>{' '}
                  <span className="text-fg-muted">{when.format(new Date(c.createdAt))}</span>
                </p>
                <p className="whitespace-pre-line">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            run(
              () => commentDecision({ data: { requestId, body: message.trim() } }),
              async () => {
                setMessage('');
                await load();
              },
            );
          }}
        >
          <label className="grid flex-1 gap-1 text-body-sm">
            <span className="sr-only">{m.todo_write()}</span>
            <textarea
              className="min-h-11 w-full rounded-control border border-line-control bg-surface-control p-2.5"
              placeholder={m.todo_write()}
              value={message}
              maxLength={2000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <Button type="submit" variant="secondary" disabled={busy || !message.trim()}>
            {m.todo_send()}
          </Button>
        </form>
      </section>

      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}

      {detail.mayDecide && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button data-shortcut="a" disabled={busy} onClick={() => decide('approve')}>
            <Icon name="check" size={16} /> {m.approve()} <Kbd>A</Kbd>
          </Button>
          <span data-shortcut="r" className="contents">
            <DialogForm title={m.refuse()} ready busy={busy} onSubmit={() => decide('refuse')}>
              <label className="grid gap-1.5 text-body-sm font-semibold">
                {m.inbox_reason()}
                <textarea
                  className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </DialogForm>
          </span>
        </div>
      )}
    </div>
  );
}
