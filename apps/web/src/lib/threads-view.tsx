import { Button, CanvasIcon, DecisionCard, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ageOf } from '@/lib/for-me-view';
import { refusal } from '@/lib/forms';
import { shownMoney } from '@/lib/money';
import type { ProjectMoney } from '@/lib/project-money';
import {
  actionDone,
  changeMembers,
  decideOutside,
  draftFromMessage,
  editInThread,
  exportProof,
  markThreadUnread,
  moveInThreads,
  openGroup,
  postToThread,
  searchThreads,
  sendThreadFile,
  type Found,
  type Message,
  type Thread,
  type ThreadHolding,
  type ThreadSummary,
  type ThreadView,
} from '@/lib/threads';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// The threads screen (doctrine D-057; specs 090, 098): her threads on the left — by last activity,
// unread in bold, ✔ when nothing waits —, the conversation in the middle, live, and the state of
// its object on the right. A trace at least as good as mail, and a place to work in: mentions,
// files, quoted answers, actions with their holder, the object's cards, Kete in the thread.

const KETE = 'agt_assistant';
type Person = { id: string; name: string };

const hour = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );
const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? hour(iso)
    : new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(date);
};
const dueDay = (day: string) =>
  new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long' }).format(
    new Date(`${day}T12:00:00Z`),
  );
const sizeOf = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} ko`
    : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

/** Her threads, live: a change in one she reads reloads what the screen shows. */
function useLive() {
  const router = useRouter();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/fils/flux');
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener('thread', () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void router.invalidate();
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [router]);
}

function Avatar({ name, kind }: { name: string; kind: string }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w.charAt(0)))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return (
    <span
      className={`inline-flex size-7 flex-none items-center justify-center text-[11px] font-bold ${
        kind === 'agent'
          ? 'rounded-control bg-fg text-bg'
          : kind === 'contact'
            ? 'rounded-full bg-state-success-fg text-bg'
            : 'rounded-full bg-surface-selected text-fg'
      }`}
      aria-hidden="true"
    >
      {kind === 'agent' ? <CanvasIcon name="bot" size={14} /> : initials || '·'}
    </span>
  );
}

/** Words with their mentions shown: « @Name » stands out. */
function Said({ text, names }: { text: string; names: string[] }) {
  if (names.length === 0) return <>{text}</>;
  const pattern = new RegExp(
    `(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`,
    'g',
  );
  return (
    <>
      {text.split(pattern).map((part, i) =>
        part.startsWith('@') && names.includes(part.slice(1)) ? (
          <b key={i} className="rounded-[4px] bg-surface-selected px-0.5 text-link">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// --- The list ------------------------------------------------------------------------------------

function NewGroup({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2 rounded-control border border-line bg-bg p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        void openGroup({ data: { title, members: chosen } })
          .then((answer) => {
            if (!answer.ok) return setError(refusal(answer.error));
            window.location.href = `/fils?fil=${answer.data.thread.id}`;
          })
          .finally(() => setBusy(false));
      }}
    >
      <label className="grid gap-1 text-body-sm font-semibold">
        {m.threads_new_group()}
        <input
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          placeholder={m.threads_new_group_hint()}
          className="h-(--control-height) rounded-control border border-line-control bg-control px-2 font-normal"
        />
      </label>
      <fieldset className="grid max-h-40 gap-0.5 overflow-auto text-body-sm">
        <legend className="mb-1 font-semibold">{m.threads_members_choose()}</legend>
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={chosen.includes(p.id)}
              onChange={(event) =>
                setChosen((list) =>
                  event.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id),
                )
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <span className="flex gap-2">
        <Button type="submit" disabled={busy || !title.trim()}>
          {m.threads_open()}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {m.common_cancel()}
        </Button>
      </span>
      {error && <p className="text-body-sm text-state-error-fg">{error}</p>}
    </form>
  );
}

function Search() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    const timer = setTimeout(() => {
      void searchThreads({ data: { q } }).then(setFound);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <div className="grid gap-1">
      <label className="relative block">
        <span className="sr-only">{m.threads_search()}</span>
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-muted">
          <CanvasIcon name="search" size={14} />
        </span>
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={m.threads_search()}
          className="h-(--control-height) w-full rounded-control border border-line-control bg-control pr-2 pl-7 text-body-sm"
        />
      </label>
      {found && (
        <ul className="grid max-h-72 gap-0.5 overflow-auto rounded-control border border-line bg-bg p-1">
          {found.length === 0 && (
            <li className="px-2 py-1 text-body-sm text-fg-muted">{m.threads_search_none()}</li>
          )}
          {found.map((hit) => (
            <li key={hit.id}>
              <a
                href={`/fils?fil=${hit.thread}#${hit.id}`}
                className="grid rounded-control px-2 py-1 text-body-sm hover:bg-surface-hover"
              >
                <span className="truncate font-semibold">{hit.threadTitle}</span>
                <span className="truncate text-fg-muted">
                  {hit.authorName} : {hit.text}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThreadList({
  threads,
  names,
  current,
  people,
}: {
  threads: ThreadSummary[];
  names: Record<string, string>;
  current: string | null;
  people: Person[];
}) {
  const [creating, setCreating] = useState(false);
  const groups: { label: string; items: ThreadSummary[] }[] = [
    { label: m.threads_objects(), items: threads.filter((t) => t.thread.kind === 'object') },
    { label: m.threads_groups(), items: threads.filter((t) => t.thread.kind === 'group') },
    { label: m.threads_direct(), items: threads.filter((t) => t.thread.kind === 'direct') },
  ];
  return (
    <nav
      aria-label={m.nav_threads()}
      className={`flex min-h-0 flex-col gap-2 overflow-auto border-r border-line bg-surface p-2 ${current ? 'max-[1000px]:hidden' : ''}`}
    >
      <Search />
      {creating ? (
        <NewGroup people={people} onClose={() => setCreating(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <CanvasIcon name="plus" size={14} /> {m.threads_new_group()}
        </Button>
      )}
      {groups.map((group) => (
        <div key={group.label} className="grid gap-0.5">
          <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
            {group.label}
          </p>
          {group.items.length === 0 && (
            <p className="px-2 text-body-sm text-fg-muted">{m.threads_none()}</p>
          )}
          {group.items.map((t) => {
            const unread = t.unread > 0;
            const author = t.last ? (names[t.last.author.id] ?? '') : '';
            return (
              <a
                key={t.thread.id}
                href={`/fils?fil=${t.thread.id}`}
                aria-current={t.thread.id === current ? 'page' : undefined}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-control px-2 py-1.5 text-body-sm ${
                  t.thread.id === current ? 'bg-surface-selected' : 'hover:bg-surface-hover'
                }`}
              >
                <span
                  className={`flex min-w-0 items-center gap-1.5 ${unread ? 'font-bold' : 'font-semibold'}`}
                >
                  {t.openActions === 0 && t.thread.kind === 'object' && (
                    <span className="text-state-success-fg" title={m.threads_resolved()}>
                      <CanvasIcon name="ok" size={12} />
                    </span>
                  )}
                  <span className="truncate">{t.thread.title}</span>
                </span>
                <span className="text-[11px] text-fg-muted">{when(t.lastAt)}</span>
                <span className={`truncate text-[12px] ${unread ? 'text-fg' : 'text-fg-muted'}`}>
                  {t.last ? `${author} : ${t.last.text}` : m.threads_empty_short()}
                </span>
                {unread ? (
                  <span
                    className="justify-self-end rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-action"
                    aria-label={m.threads_unread({ count: String(t.unread) })}
                  >
                    {t.unread}
                  </span>
                ) : (
                  <span />
                )}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// --- A message -----------------------------------------------------------------------------------

const viaWord = (via: Message['via']) =>
  ({
    kete: null,
    whatsapp: m.threads_via_whatsapp(),
    telegram: m.threads_via_telegram(),
    mail: m.threads_via_mail(),
    form: m.threads_via_form(),
  })[via];

const priorityWord: Record<string, () => string> = {
  urgent: m.threads_priority_urgent,
  high: m.threads_priority_high,
  normal: m.threads_priority_normal,
  low: m.threads_priority_low,
};

function ActionBlock({
  action,
  names,
  me,
}: {
  action: ThreadHolding;
  names: Record<string, string>;
  me: string;
}) {
  const router = useRouter();
  const done = action.state === 'done' || Boolean(action.doneAt);
  return (
    <div
      className={`mt-1.5 flex flex-wrap items-center gap-2 rounded-control border px-2 py-1 text-body-sm ${
        done ? 'border-line text-fg-muted' : 'border-state-verify-fg/40 bg-state-verify-bg'
      }`}
    >
      <CanvasIcon name={done ? 'ok' : 'decide'} size={14} />
      <span>
        {done
          ? m.threads_action_done({ name: names[action.holder.id] ?? '' })
          : m.threads_action_held({ name: names[action.holder.id] ?? '' })}
      </span>
      {action.due && !done && <Tag tone="verify">{m.threads_due({ day: dueDay(action.due) })}</Tag>}
      {action.priority !== 'normal' && !done && (
        <Tag tone={action.priority === 'urgent' ? 'error' : 'info'}>
          {priorityWord[action.priority]?.() ?? action.priority}
        </Tag>
      )}
      {!done && action.holder.id === me && (
        <Button
          variant="secondary"
          onClick={() =>
            void actionDone({ data: { holdingId: action.holdingId } }).then(() =>
              router.invalidate(),
            )
          }
        >
          {m.threads_action_finish()}
        </Button>
      )}
    </div>
  );
}

function MessageMenu({
  message,
  mine,
  holder,
  threads,
  onReply,
  onEdit,
}: {
  message: Message;
  mine: boolean;
  holder: boolean;
  threads: ThreadSummary[];
  onReply: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'menu' | 'move' | 'create' | null>(null);
  const [what, setWhat] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const others = threads.filter((t) => t.thread.id !== message.thread);
  return (
    <span className="relative inline-flex flex-wrap items-center gap-3">
      <button type="button" className="font-semibold text-link" onClick={onReply}>
        {m.threads_reply()}
      </button>
      {mine && !message.movedTo && (
        <button type="button" className="font-semibold text-link" onClick={onEdit}>
          {m.threads_edit()}
        </button>
      )}
      <button
        type="button"
        aria-expanded={open !== null}
        aria-label={m.threads_more()}
        className="text-fg-muted hover:text-fg"
        onClick={() => setOpen((o) => (o ? null : 'menu'))}
      >
        <CanvasIcon name="more" size={14} />
      </button>
      {open && (
        <span className="absolute top-6 left-0 z-20 grid w-64 gap-1 rounded-control border border-line bg-surface p-2 shadow-lg">
          {open === 'menu' && (
            <>
              <button
                type="button"
                className="rounded-control px-2 py-1 text-left hover:bg-surface-hover"
                onClick={() => setOpen('create')}
              >
                {m.threads_create_from()}
              </button>
              {(mine || holder) && !message.movedTo && (
                <button
                  type="button"
                  className="rounded-control px-2 py-1 text-left hover:bg-surface-hover"
                  onClick={() => setOpen('move')}
                >
                  {m.threads_move()}
                </button>
              )}
              <button
                type="button"
                className="rounded-control px-2 py-1 text-left hover:bg-surface-hover"
                onClick={() =>
                  void markThreadUnread({
                    data: { threadId: message.thread, from: message.first },
                  }).then(() => {
                    window.location.href = '/fils?liste=1';
                  })
                }
              >
                {m.threads_mark_unread()}
              </button>
            </>
          )}
          {open === 'move' && (
            <>
              <span className="px-2 text-[11px] font-semibold text-fg-muted uppercase">
                {m.threads_move_to()}
              </span>
              {others.map((t) => (
                <button
                  key={t.thread.id}
                  type="button"
                  className="truncate rounded-control px-2 py-1 text-left hover:bg-surface-hover"
                  onClick={() =>
                    void moveInThreads({
                      data: { messageId: message.first, to: t.thread.id },
                    }).then(async (answer) => {
                      if (!answer.ok) return setNote(refusal(answer.error));
                      setOpen(null);
                      await router.invalidate();
                    })
                  }
                >
                  {t.thread.title}
                </button>
              ))}
            </>
          )}
          {open === 'create' && (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void draftFromMessage({ data: { messageId: message.first, what } }).then(
                  (answer) => {
                    setNote(answer.ok ? m.threads_create_asked() : refusal(answer.error));
                    if (answer.ok) setOpen(null);
                  },
                );
              }}
            >
              <span className="text-body-sm">{m.threads_create_hint()}</span>
              <span className="flex flex-wrap gap-1">
                {[
                  m.threads_create_ticket(),
                  m.threads_create_expense(),
                  m.threads_create_quote(),
                  m.threads_create_request(),
                  m.threads_create_task(),
                ].map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="rounded-full border border-line-control px-2 py-0.5 text-[12px] hover:bg-surface-hover"
                    onClick={() => setWhat(choice)}
                  >
                    {choice}
                  </button>
                ))}
              </span>
              <input
                value={what}
                onChange={(event) => setWhat(event.target.value)}
                className="h-(--control-height) rounded-control border border-line-control bg-control px-2"
                aria-label={m.threads_create_from()}
              />
              <Button type="submit" disabled={what.trim().length < 2}>
                {m.threads_create_ask()}
              </Button>
            </form>
          )}
          {note && <span className="px-2 text-body-sm text-fg-muted">{note}</span>}
        </span>
      )}
      {note && !open && <span className="text-fg-muted">{note}</span>}
    </span>
  );
}

function MessageItem({
  message,
  view,
  me,
  threads,
  quoted,
  onReply,
}: {
  message: Message;
  view: ThreadView;
  me: string;
  threads: ThreadSummary[];
  quoted: Message | undefined;
  onReply: (message: Message) => void;
}) {
  const router = useRouter();
  const names = view.names;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const name = names[message.author.id] ?? m.threads_someone();
  const via = viaWord(message.via);
  const mine = message.author.kind === 'person' && message.author.id === me;
  const readers = message.readBy
    .filter((r) => r.id !== message.author.id)
    .map((r) => `${names[r.id] ?? m.threads_someone()} ${hour(r.at)}`);
  const action = view.actions[message.first];
  const pending = view.pending[message.first];
  const outside = message.visibility === 'outside';
  const mentioned = (message.mentions ?? []).map((x) => names[x.id] ?? '').filter(Boolean);
  return (
    <li id={message.first} className="grid scroll-mt-4 grid-cols-[28px_minmax(0,1fr)] gap-3">
      <Avatar name={name} kind={message.author.kind} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-2 text-body-sm text-fg-muted">
          <b className="text-body text-fg">{name}</b>
          {message.author.kind === 'agent' && <Tag tone="agent">{m.threads_agent()}</Tag>}
          <time dateTime={message.at}>{hour(message.at)}</time>
          {via && <Tag tone="validated">{via}</Tag>}
          {outside && message.author.kind !== 'contact' && (
            <Tag tone="verify">{m.threads_to_client()}</Tag>
          )}
          {message.for === 'action' && !action && <Tag tone="verify">{m.threads_for_action()}</Tag>}
          {message.edits > 0 && <span>{m.threads_edited()}</span>}
          {message.moved_from && <span>{m.threads_moved_here()}</span>}
        </p>
        {quoted && (
          <a
            href={`#${quoted.first}`}
            className="mt-1 block truncate border-l-2 border-line-strong pl-2 text-body-sm text-fg-muted"
          >
            {names[quoted.author.id] ?? ''} : {quoted.text}
          </a>
        )}
        {editing ? (
          <form
            className="mt-1 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void editInThread({ data: { messageId: message.id, text: draft } }).then(
                async (a) => {
                  if (a.ok) {
                    setEditing(false);
                    await router.invalidate();
                  }
                },
              );
            }}
          >
            <textarea
              aria-label={m.threads_edit()}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-16 rounded-control border border-line-strong bg-control p-2"
            />
            <span className="flex gap-2">
              <Button type="submit">{m.threads_keep_edit()}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                {m.common_cancel()}
              </Button>
            </span>
            <span className="text-body-sm text-fg-muted">{m.threads_edit_keeps()}</span>
          </form>
        ) : (
          <p
            className={`mt-0.5 whitespace-pre-wrap ${message.movedTo ? 'text-fg-muted line-through' : ''}`}
          >
            <Said text={message.text} names={mentioned} />
          </p>
        )}
        {message.movedTo && (
          <a
            href={`/fils?fil=${message.movedTo.thread}#${message.movedTo.message}`}
            className="text-body-sm font-semibold text-link"
          >
            {m.threads_moved_away()}
          </a>
        )}
        {(message.attachments ?? []).length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {message.attachments?.map((file) => (
              <a
                key={file.id}
                href={`/api/fils/fichiers/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-1 text-body-sm hover:bg-surface-hover"
              >
                <CanvasIcon name="clip" size={13} />
                {file.name}
                {file.bytes ? <span className="text-fg-muted">{sizeOf(file.bytes)}</span> : null}
              </a>
            ))}
          </span>
        )}
        {action && <ActionBlock action={action} names={names} me={me} />}
        {pending && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-control border border-line px-2 py-1 text-body-sm">
            <span>
              {pending.state === 'waiting'
                ? m.threads_outside_waiting({
                    names: pending.approvers.map((a) => names[a] ?? '').join(', '),
                  })
                : pending.state === 'sent'
                  ? m.threads_outside_sent({ name: names[pending.decidedBy ?? ''] ?? '' })
                  : m.threads_outside_refused({ name: names[pending.decidedBy ?? ''] ?? '' })}
            </span>
            {pending.state === 'waiting' && pending.approvers.includes(me) && (
              <>
                <Button
                  onClick={() =>
                    void decideOutside({ data: { messageId: message.first, approve: true } }).then(
                      () => router.invalidate(),
                    )
                  }
                >
                  {m.threads_outside_approve()}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void decideOutside({ data: { messageId: message.first, approve: false } }).then(
                      () => router.invalidate(),
                    )
                  }
                >
                  {m.threads_outside_refuse()}
                </Button>
              </>
            )}
          </div>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-body-sm text-fg-muted">
          <span>
            {readers.length > 0
              ? m.threads_read_by({ who: readers.join(', ') })
              : mine
                ? m.threads_sent()
                : m.threads_read_by_nobody()}
          </span>
          {!editing && (
            <MessageMenu
              message={message}
              mine={mine}
              holder={view.thread.holder.id === me}
              threads={threads}
              onReply={() => onReply(message)}
              onEdit={() => setEditing(true)}
            />
          )}
        </p>
      </div>
    </li>
  );
}

// --- The composer ------------------------------------------------------------------------------

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function Composer({
  view,
  me,
  people,
  replyTo,
  onReplyDone,
}: {
  view: ThreadView;
  me: string;
  people: Person[];
  replyTo: Message | null;
  onReplyDone: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [forWhat, setForWhat] = useState<'information' | 'action'>('information');
  const [to, setTo] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [outside, setOutside] = useState(false);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [mentions, setMentions] = useState<Person[]>([]);
  const [suggest, setSuggest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const members = (view.thread.members ?? []).filter(
    (mb) => !mb.until && mb.kind !== 'contact' && mb.id !== me,
  );
  const contacts = (view.thread.members ?? []).filter((mb) => mb.kind === 'contact' && !mb.until);
  const channels = [
    ...new Set(
      contacts.map((c) =>
        c.id.startsWith('mail:')
          ? m.threads_via_mail()
          : c.id.startsWith('telegram:')
            ? m.threads_via_telegram()
            : m.threads_via_whatsapp(),
      ),
    ),
  ];
  // Who can be mentioned: Kete, the thread's members, the organization's people.
  const candidates = useMemo(() => {
    const known = new Map<string, Person>([[KETE, { id: KETE, name: 'Kete' }]]);
    for (const mb of members) known.set(mb.id, { id: mb.id, name: view.names[mb.id] ?? mb.id });
    for (const p of people) if (p.id !== me) known.set(p.id, p);
    return [...known.values()];
  }, [members, people, view.names, me]);
  const shown =
    suggest === null
      ? []
      : candidates.filter((c) => c.name.toLowerCase().includes(suggest.toLowerCase())).slice(0, 6);

  function typed(value: string) {
    setText(value);
    const at = /(?:^|\s)@([\p{L}' -]{0,30})$/u.exec(
      value.slice(0, input.current?.selectionStart ?? value.length),
    );
    setSuggest(at ? (at[1] ?? '') : null);
  }
  function mention(person: Person) {
    const cut = text.replace(/@([\p{L}' -]{0,30})$/u, `@${person.name} `);
    setText(cut);
    setMentions((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]));
    setSuggest(null);
    input.current?.focus();
  }

  async function attach(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      const answer = await sendThreadFile({
        data: {
          threadId: view.thread.id,
          name: file.name,
          contentType: file.type,
          data: await toBase64(file),
        },
      });
      if (answer.ok)
        setFiles((f) => [...f, { id: answer.data.file.id, name: answer.data.file.name }]);
      else setNote(refusal(answer.error));
    }
  }

  return (
    <form
      className="grid flex-none gap-2 border-t border-line bg-surface p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void attach(event.dataTransfer.files);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setNote(null);
        const said = mentions.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);
        void postToThread({
          data: {
            threadId: view.thread.id,
            text,
            for: forWhat,
            ...(forWhat === 'action' && to ? { to } : {}),
            ...(forWhat === 'action' && due ? { due } : {}),
            ...(forWhat === 'action' ? { priority } : {}),
            ...(replyTo ? { replyTo: replyTo.first } : {}),
            mentions: said,
            files: files.map((f) => f.id),
            visibility: outside ? 'outside' : 'internal',
          },
        })
          .then(async (answer) => {
            if (!answer.ok) return setNote(refusal(answer.error));
            setText('');
            setFiles([]);
            setMentions([]);
            onReplyDone();
            const { delivered, waiting } = answer.data;
            if (waiting.length > 0) {
              setNote(m.threads_outside_asked());
            } else if (delivered) {
              const reached = [
                ...delivered.mailed,
                ...delivered.chat.sent,
                ...delivered.chat.byTemplate,
              ];
              setNote(
                delivered.chat.refused.length > 0
                  ? m.threads_outside_window()
                  : reached.length > 0
                    ? m.threads_mailed({ to: reached.join(', ') })
                    : m.threads_outside_nobody(),
              );
            }
            if (said.includes(KETE)) setNote(m.threads_kete_thinking());
            await router.invalidate();
          })
          .finally(() => setBusy(false));
      }}
    >
      {replyTo && (
        <p className="flex items-center gap-2 border-l-2 border-accent pl-2 text-body-sm text-fg-muted">
          <span className="min-w-0 flex-1 truncate">
            {m.threads_replying({ name: view.names[replyTo.author.id] ?? '' })} — {replyTo.text}
          </span>
          <button type="button" aria-label={m.common_cancel()} onClick={onReplyDone}>
            <CanvasIcon name="x" size={14} />
          </button>
        </p>
      )}
      <div className="relative">
        <label htmlFor="thread-say" className="sr-only">
          {m.threads_write()}
        </label>
        <textarea
          id="thread-say"
          ref={input}
          value={text}
          rows={2}
          onChange={(event) => typed(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={m.threads_write_hint()}
          className="max-h-48 min-h-16 w-full resize-y rounded-control border border-line-strong bg-control p-2"
        />
        {shown.length > 0 && (
          <ul
            role="listbox"
            className="absolute bottom-full left-2 z-20 mb-1 grid w-60 rounded-control border border-line bg-surface p-1 shadow-lg"
          >
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-body-sm hover:bg-surface-hover"
                  onClick={() => mention(c)}
                >
                  <Avatar name={c.name} kind={c.id.startsWith('agt_') ? 'agent' : 'person'} />
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1 rounded-control border border-line px-2 py-0.5 text-body-sm"
            >
              <CanvasIcon name="clip" size={12} />
              {f.name}
              <button
                type="button"
                aria-label={m.common_cancel()}
                onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
              >
                <CanvasIcon name="x" size={12} />
              </button>
            </span>
          ))}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={m.threads_for_what()}
          className="inline-flex rounded-control border border-line-control p-0.5"
        >
          {(['information', 'action'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={forWhat === value}
              onClick={() => setForWhat(value)}
              className={`rounded-[4px] px-2 py-1 text-body-sm font-semibold ${
                forWhat === value ? 'bg-surface-selected text-fg' : 'text-fg-muted'
              }`}
            >
              {value === 'action' ? m.threads_for_action() : m.threads_for_information()}
            </button>
          ))}
        </div>
        {contacts.length > 0 && (
          <div
            role="group"
            aria-label={m.threads_who_reads()}
            className="inline-flex rounded-control border border-line-control p-0.5"
          >
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={outside === value}
                onClick={() => setOutside(value)}
                className={`rounded-[4px] px-2 py-1 text-body-sm font-semibold ${
                  outside === value ? 'bg-surface-selected text-fg' : 'text-fg-muted'
                }`}
              >
                {value
                  ? m.threads_to_client_by({ channels: channels.join(', ') })
                  : m.threads_internal_note()}
              </button>
            ))}
          </div>
        )}
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void attach(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          aria-label={m.threads_attach()}
          title={m.threads_attach()}
          className="inline-flex size-(--control-height) items-center justify-center rounded-control border border-line-control text-fg-muted hover:text-fg"
        >
          <CanvasIcon name="clip" size={15} />
        </button>
        <button
          type="button"
          onClick={() => {
            typed(`${text}${text && !text.endsWith(' ') ? ' ' : ''}@`);
            input.current?.focus();
          }}
          aria-label={m.threads_mention()}
          title={m.threads_mention()}
          className="inline-flex size-(--control-height) items-center justify-center rounded-control border border-line-control text-fg-muted hover:text-fg"
        >
          <CanvasIcon name="at" size={15} />
        </button>
        <span className="flex-1" />
        <Button type="submit" disabled={busy || !text.trim()}>
          <CanvasIcon name="send" size={14} /> {m.threads_send()}
        </Button>
      </div>
      {forWhat === 'action' && (
        <div className="flex flex-wrap items-center gap-2 text-body-sm">
          <label className="inline-flex items-center gap-1">
            {m.threads_who_acts()}
            <select
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-(--control-height) rounded-control border border-line-control bg-control px-2"
            >
              <option value="">{m.threads_holder_acts()}</option>
              {members.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {view.names[mb.id] ?? mb.id}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1">
            {m.threads_by_when()}
            <input
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="h-(--control-height) rounded-control border border-line-control bg-control px-2"
            />
          </label>
          <label className="inline-flex items-center gap-1">
            {m.threads_how_urgent()}
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-(--control-height) rounded-control border border-line-control bg-control px-2"
            >
              {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
                <option key={p} value={p}>
                  {priorityWord[p]?.()}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {outside && !view.mailbox && contacts.some((c) => c.id.startsWith('mail:')) && (
        <p className="text-body-sm text-state-verify-fg">{m.threads_no_mailbox()}</p>
      )}
      {note && <p className="text-body-sm text-fg-muted">{note}</p>}
    </form>
  );
}

// --- The state beside it ------------------------------------------------------------------------

function StateBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Members({ view, me, people }: { view: ThreadView; me: string; people: Person[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState('');
  const members = (view.thread.members ?? []).filter((mb) => !mb.until);
  const holder = view.thread.holder.id === me;
  const addable = people.filter((p) => !members.some((mb) => mb.id === p.id));
  const change = (body: { add?: string[]; remove?: string[] }) =>
    void changeMembers({ data: { threadId: view.thread.id, ...body } }).then(() =>
      router.invalidate(),
    );
  return (
    <StateBlock title={m.threads_members({ count: String(members.length) })}>
      <ul className="grid gap-1">
        {members.map((mb) => (
          <li key={`${mb.id}-${mb.since}`} className="flex items-center gap-2 text-body-sm">
            <Avatar name={view.names[mb.id] ?? ''} kind={mb.kind} />
            <span className="truncate">{view.names[mb.id] ?? m.threads_someone()}</span>
            <span className="ml-auto text-[11.5px] text-fg-muted">
              {mb.id === view.thread.holder.id
                ? m.threads_holds()
                : mb.role === 'subscriber'
                  ? m.threads_subscriber()
                  : m.threads_since({ day: dayOf(mb.since) })}
            </span>
            {holder && mb.id !== me && mb.id !== view.thread.holder.id && mb.kind !== 'contact' && (
              <button
                type="button"
                aria-label={m.threads_remove_member({ name: view.names[mb.id] ?? '' })}
                className="text-fg-muted hover:text-fg"
                onClick={() => change({ remove: [mb.id] })}
              >
                <CanvasIcon name="x" size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {holder &&
        (adding ? (
          <span className="flex gap-1">
            <select
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
              aria-label={m.threads_add_member()}
              className="h-(--control-height) min-w-0 flex-1 rounded-control border border-line-control bg-control px-2 text-body-sm"
            >
              <option value="">—</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={KETE}>Kete</option>
            </select>
            <Button
              disabled={!chosen}
              onClick={() => {
                change({ add: [chosen] });
                setAdding(false);
                setChosen('');
              }}
            >
              {m.threads_add()}
            </Button>
          </span>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <CanvasIcon name="plus" size={13} /> {m.threads_add_member()}
          </Button>
        ))}
    </StateBlock>
  );
}

function ThreadState({
  view,
  money,
  me,
  people,
  shown,
  onClose,
}: {
  view: ThreadView;
  money: ProjectMoney | null;
  me: string;
  people: Person[];
  shown: boolean;
  onClose: () => void;
}) {
  const [proof, setProof] = useState<string | null>(null);
  return (
    <aside
      aria-label={m.threads_state()}
      className={`flex min-h-0 flex-col gap-5 overflow-auto border-l border-line bg-surface p-4 ${
        shown
          ? 'max-[1200px]:fixed max-[1200px]:inset-y-0 max-[1200px]:right-0 max-[1200px]:z-30 max-[1200px]:w-[min(340px,100%)] max-[1200px]:shadow-xl'
          : 'max-[1200px]:hidden'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className="hidden items-center justify-self-end gap-1 self-end text-body-sm font-semibold text-link max-[1200px]:inline-flex"
      >
        <CanvasIcon name="x" size={14} />
        {m.common_close()}
      </button>
      {view.link && (
        <a
          href={view.link}
          target={view.link.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-semibold text-link"
        >
          <CanvasIcon name="ext" size={14} /> {m.threads_open_object()}
        </a>
      )}
      {money && (
        <StateBlock title={m.threads_money()}>
          <dl className="grid grid-cols-2 gap-2 text-body-sm">
            {(
              [
                [m.threads_invoiced(), money.invoiced],
                [m.threads_received(), money.received],
                [m.threads_committed(), money.committed],
                [m.threads_available(), money.available],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-control border border-line bg-bg px-2 py-1.5">
                <dt className="text-[11px] text-fg-muted">{label}</dt>
                <dd className="font-mono font-semibold tabular-nums">
                  {shownMoney(value, money.currency)}
                </dd>
              </div>
            ))}
          </dl>
        </StateBlock>
      )}
      <StateBlock title={m.threads_holdings({ count: String(view.holdings.length) })}>
        {view.holdings.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.threads_holdings_none()}</p>
        ) : (
          <ul className="grid divide-y divide-line">
            {view.holdings.map((h) => (
              <li
                key={h.holdingId}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 py-1.5 text-body-sm"
              >
                <span className="truncate">{h.what}</span>
                <span className="font-mono text-state-verify-fg">
                  {h.due ? dueDay(h.due) : ageOf(h.since)}
                </span>
                <span className="col-span-2 text-[12px] text-fg-muted">
                  {view.names[h.holder.id] ?? m.threads_someone()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </StateBlock>
      {view.dates.length > 0 && (
        <StateBlock title={m.threads_dates()}>
          <ul className="grid gap-1 text-body-sm">
            {view.dates.map((d) => (
              <li key={`${d.label}-${d.at}`} className="flex justify-between gap-2">
                <span className="truncate">{d.label}</span>
                <span className="text-fg-muted">
                  {d.at ? when(d.at.length === 10 ? `${d.at}T12:00:00Z` : d.at) : ''}
                </span>
              </li>
            ))}
          </ul>
        </StateBlock>
      )}
      {view.files.length > 0 && (
        <StateBlock title={m.threads_documents({ count: String(view.files.length) })}>
          <ul className="grid gap-1 text-body-sm">
            {view.files.map((f) => (
              <li key={f.name} className="grid">
                <a
                  href={`/api/fils/fichiers/${f.versions[0]?.id ?? ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 truncate font-semibold text-link"
                >
                  <CanvasIcon name="files" size={13} /> {f.name}
                </a>
                <span className="text-[12px] text-fg-muted">
                  {f.versions.length > 1
                    ? m.threads_versions({ count: String(f.versions.length) })
                    : `${view.names[f.versions[0]?.by ?? ''] ?? ''} · ${when(f.versions[0]?.at ?? new Date().toISOString())}`}
                </span>
              </li>
            ))}
          </ul>
        </StateBlock>
      )}
      {view.done.length > 0 && (
        <StateBlock title={m.threads_done_lately()}>
          <ul className="grid gap-1 text-body-sm">
            {view.done.map((d) => (
              <li key={`${d.what}-${d.at}`} className="flex gap-1.5 text-fg-muted">
                <span className="text-state-success-fg">
                  <CanvasIcon name="ok" size={12} />
                </span>
                <span className="truncate">{d.what}</span>
              </li>
            ))}
          </ul>
        </StateBlock>
      )}
      <Members view={view} me={me} people={people} />
      {view.thread.address && (
        <StateBlock title={m.threads_address()}>
          <p className="font-mono text-body-sm break-all">{view.thread.address}</p>
        </StateBlock>
      )}
      <StateBlock title={m.threads_proof()}>
        <Button
          variant="secondary"
          onClick={() => {
            void exportProof({ data: { threadId: view.thread.id } }).then((p) =>
              setProof(
                m.threads_proof_done({ count: String(p.messages), fingerprint: p.fingerprint }),
              ),
            );
          }}
        >
          {m.threads_export()}
        </Button>
        {proof && <p className="font-mono text-[11px] break-all text-fg-muted">{proof}</p>}
      </StateBlock>
    </aside>
  );
}

// --- The cards of its object ---------------------------------------------------------------------

function Cards({ view, me }: { view: ThreadView; me: string }) {
  if (view.cards.length === 0) return null;
  return (
    <div className="grid gap-2 border-b border-line bg-surface px-4 py-3">
      {view.cards.map((card) => (
        <DecisionCard
          key={card.holdingId}
          title={card.what}
          asker={m.threads_card_for({ name: view.names[card.holder.id] ?? m.threads_someone() })}
          actions={
            card.href ? (
              <a href={card.href} className="inline-flex">
                <Button variant={card.holder.id === me ? 'primary' : 'secondary'}>
                  {card.holder.id === me ? m.threads_card_decide() : m.threads_card_open()}
                </Button>
              </a>
            ) : null
          }
        />
      ))}
    </div>
  );
}

// --- The screen ---------------------------------------------------------------------------------

/** The whole screen: the list, the thread, its state. */
export function ThreadsScreen({
  threads,
  names,
  view,
  money,
  me,
  people,
}: {
  threads: ThreadSummary[];
  names: Record<string, string>;
  view: ThreadView | null;
  money: ProjectMoney | null;
  me: string;
  people: Person[];
}) {
  useLive();
  const [stateShown, setStateShown] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const count = view?.messages.length ?? 0;
  useEffect(() => {
    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    } else {
      end.current?.scrollIntoView({ block: 'end' });
    }
  }, [view?.thread.id, count]);
  const byId = useMemo(
    () =>
      new Map(
        (view?.messages ?? []).flatMap((msg) => [
          [msg.first, msg] as const,
          [msg.id, msg] as const,
        ]),
      ),
    [view],
  );
  const open = view
    ? Object.values(view.actions).filter((a) => a.state !== 'done' && !a.doneAt).length
    : 0;
  let lastDay = '';
  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)_320px] overflow-hidden max-[1200px]:grid-cols-[260px_minmax(0,1fr)] max-[1000px]:grid-cols-1">
      <ThreadList
        threads={threads}
        names={names}
        current={view?.thread.id ?? null}
        people={people}
      />
      {view ? (
        <section aria-label={view.thread.title} className="flex min-h-0 min-w-0 flex-col bg-bg">
          <header className="flex flex-none flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
            <a
              href="/fils?liste=1"
              aria-label={m.threads_back()}
              className="hidden size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover max-[1000px]:inline-flex"
            >
              <CanvasIcon name="left" size={16} />
            </a>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold">{view.thread.title}</h1>
              <p className="text-body-sm text-fg-muted">
                {m.threads_held_by({
                  name: view.names[view.thread.holder.id] ?? m.threads_someone(),
                })}
                {' · '}
                {open > 0
                  ? m.threads_open_actions({ count: String(open) })
                  : m.threads_nothing_waits()}
                {view.thread.state === 'closed' && ` · ${m.threads_closed()}`}
              </p>
            </div>
            <button
              type="button"
              aria-pressed={stateShown}
              onClick={() => setStateShown((o) => !o)}
              className="hidden h-(--control-height) items-center gap-1.5 rounded-control border border-line-control px-2.5 text-body-sm font-semibold max-[1200px]:inline-flex"
            >
              <CanvasIcon name="layers" size={14} />
              {m.threads_state()}
            </button>
          </header>
          <Cards view={view} me={me} />
          <ol className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4" aria-live="polite">
            {view.messages.length === 0 && <li className="text-fg-muted">{m.threads_empty()}</li>}
            {view.messages.map((message) => {
              const day = dayOf(message.at);
              const separator = day !== lastDay;
              lastDay = day;
              return (
                <li key={message.first} className="grid gap-3">
                  {separator && (
                    <span className="justify-self-center rounded-full border border-line bg-surface px-3 py-0.5 text-[11.5px] font-semibold text-fg-muted first-letter:uppercase">
                      {day}
                    </span>
                  )}
                  <ul>
                    <MessageItem
                      message={message}
                      view={view}
                      me={me}
                      threads={threads}
                      quoted={message.reply_to ? byId.get(message.reply_to) : undefined}
                      onReply={setReplyTo}
                    />
                  </ul>
                </li>
              );
            })}
            <li ref={end} aria-hidden="true" />
          </ol>
          {view.thread.state === 'open' && (
            <Composer
              view={view}
              me={me}
              people={people}
              replyTo={replyTo}
              onReplyDone={() => setReplyTo(null)}
            />
          )}
        </section>
      ) : (
        <section className="grid place-items-center p-8 text-center text-fg-muted max-[1000px]:hidden">
          <p>{threads.length === 0 ? m.threads_none_yet() : m.threads_pick()}</p>
        </section>
      )}
      {view && (
        <ThreadState
          view={view}
          money={money}
          me={me}
          people={people}
          shown={stateShown}
          onClose={() => setStateShown(false)}
        />
      )}
    </div>
  );
}

export type { Thread };
