import { Button, CanvasIcon, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { ageOf } from '@/lib/for-me-view';
import { refusal } from '@/lib/forms';
import { shownMoney } from '@/lib/money';
import type { ProjectMoney } from '@/lib/project-money';
import {
  editInThread,
  exportProof,
  openGroup,
  postToThread,
  type Message,
  type Thread,
  type ThreadView,
} from '@/lib/threads';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// The threads screen (doctrine D-057, spec 090): her threads on the left, the conversation in the
// middle, the state of its object on the right — who holds what, the money, the members since
// when. A trace at least as good as mail.

const kindLetter: Record<Thread['kind'], string> = {
  object: 'O',
  group: '#',
  direct: '@',
  kete: 'K',
};

const hour = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );

function Avatar({ name, kind }: { name: string; kind: string }) {
  const initials = name
    .split(/\s+/)
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
      {kind === 'agent' ? <CanvasIcon name="bot" size={14} /> : initials || '?'}
    </span>
  );
}

/** Her threads: the object's first, then groups, direct ones, hers with Kete. */
function ThreadList({ threads, current }: { threads: Thread[]; current: string | null }) {
  // On a phone, the list is its own screen: it hides while a thread is open.
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const groups: { label: string; items: Thread[] }[] = [
    { label: m.threads_objects(), items: threads.filter((t) => t.kind === 'object') },
    { label: m.threads_groups(), items: threads.filter((t) => t.kind === 'group') },
    { label: m.threads_direct(), items: threads.filter((t) => t.kind === 'direct') },
  ];
  return (
    <nav
      aria-label={m.nav_threads()}
      className={`grid content-start gap-1 overflow-auto border-r border-line bg-surface p-2 ${current ? 'max-[1000px]:hidden' : ''}`}
    >
      {groups.map((group) => (
        <div key={group.label} className="grid gap-0.5">
          <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
            {group.label}
          </p>
          {group.items.length === 0 && (
            <p className="px-2 text-body-sm text-fg-muted">{m.threads_none()}</p>
          )}
          {group.items.map((t) => (
            <a
              key={t.id}
              href={`/fils?fil=${t.id}`}
              aria-current={t.id === current ? 'page' : undefined}
              className={`flex items-center gap-2 rounded-control px-2 py-1.5 text-body-sm ${
                t.id === current ? 'bg-surface-selected font-semibold' : 'hover:bg-surface-hover'
              }`}
            >
              <span className="inline-flex size-5 flex-none items-center justify-center rounded-[4px] bg-surface-selected font-mono text-[10px] font-bold text-fg-muted">
                {kindLetter[t.kind]}
              </span>
              <span className="truncate">{t.title}</span>
            </a>
          ))}
        </div>
      ))}
      <form
        className="mt-3 grid gap-2 border-t border-line px-2 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          void openGroup({ data: { title } }).then(async (answer) => {
            if (!answer.ok) return setError(refusal(answer.error));
            window.location.href = `/fils?fil=${answer.data.thread.id}`;
            await router.invalidate();
          });
        }}
      >
        <label htmlFor="new-group" className="text-body-sm font-semibold">
          {m.threads_new_group()}
        </label>
        <input
          id="new-group"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={m.threads_new_group_hint()}
          className="h-(--control-height) rounded-control border border-line-control bg-control px-2 text-body-sm"
        />
        <Button type="submit" variant="secondary">
          {m.threads_open()}
        </Button>
        {error && <p className="text-body-sm text-state-error-fg">{error}</p>}
      </form>
    </nav>
  );
}

const viaWord = (via: Message['via']) =>
  ({
    kete: null,
    whatsapp: m.threads_via_whatsapp(),
    telegram: m.threads_via_telegram(),
    mail: m.threads_via_mail(),
    form: m.threads_via_form(),
  })[via];

function MessageItem({
  message,
  names,
  mine,
}: {
  message: Message;
  names: Record<string, string>;
  mine: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const name = names[message.author.id] ?? message.author.id;
  const via = viaWord(message.via);
  const readers = message.readBy.map((r) => `${names[r.id] ?? r.id} ${hour(r.at)}`);
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <Avatar name={name} kind={message.author.kind} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-2 text-body-sm text-fg-muted">
          <b className="text-body text-fg">{name}</b>
          {message.author.kind === 'agent' && <Tag tone="agent">{m.threads_agent()}</Tag>}
          <time dateTime={message.at}>{hour(message.at)}</time>
          {via && <Tag tone="validated">{via}</Tag>}
          {message.for === 'action' ? (
            <Tag tone="verify">
              {message.to
                ? m.threads_for_action_to({ name: names[message.to.id] ?? message.to.id })
                : m.threads_for_action()}
            </Tag>
          ) : (
            <Tag tone="info">{m.threads_for_information()}</Tag>
          )}
          {message.edits > 0 && <span>{m.threads_edited()}</span>}
        </p>
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
          <p className="mt-0.5 whitespace-pre-wrap">{message.text}</p>
        )}
        <p className="mt-1 flex flex-wrap gap-x-3 text-body-sm text-fg-muted">
          <span>
            {readers.length > 0
              ? m.threads_read_by({ who: readers.join(', ') })
              : m.threads_read_by_nobody()}
          </span>
          {mine && !editing && (
            <button
              type="button"
              className="font-semibold text-link"
              onClick={() => setEditing(true)}
            >
              {m.threads_edit()}
            </button>
          )}
        </p>
      </div>
    </li>
  );
}

function Composer({ view, me }: { view: ThreadView; me: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [forWhat, setForWhat] = useState<'information' | 'action'>('information');
  const [to, setTo] = useState('');
  const [byMail, setByMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const members = (view.thread.members ?? []).filter(
    (mb) => !mb.until && mb.kind !== 'contact' && mb.id !== me,
  );
  const mailContacts = (view.thread.members ?? []).some(
    (mb) => mb.kind === 'contact' && !mb.until && mb.id.startsWith('mail:'),
  );
  return (
    <form
      className="grid gap-2 border-t border-line bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setNote(null);
        void postToThread({
          data: {
            threadId: view.thread.id,
            text,
            for: forWhat,
            ...(forWhat === 'action' && to ? { to } : {}),
            byMail,
          },
        })
          .then(async (answer) => {
            if (!answer.ok) return setNote(refusal(answer.error));
            setText('');
            if (answer.data.mailed.length > 0) {
              setNote(m.threads_mailed({ to: answer.data.mailed.join(', ') }));
            }
            await router.invalidate();
          })
          .finally(() => setBusy(false));
      }}
    >
      <label htmlFor="thread-say" className="sr-only">
        {m.threads_write()}
      </label>
      <textarea
        id="thread-say"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={m.threads_write()}
        className="min-h-12 resize-y rounded-control border border-line-strong bg-control p-2"
      />
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
        {forWhat === 'action' && (
          <select
            aria-label={m.threads_who_acts()}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-(--control-height) rounded-control border border-line-control bg-control px-2 text-body-sm"
          >
            <option value="">{m.threads_holder_acts()}</option>
            {members.map((mb) => (
              <option key={mb.id} value={mb.id}>
                {view.names[mb.id] ?? mb.id}
              </option>
            ))}
          </select>
        )}
        {mailContacts && (
          <label className="inline-flex items-center gap-1 text-body-sm">
            <input
              type="checkbox"
              checked={byMail}
              onChange={(event) => setByMail(event.target.checked)}
            />
            {m.threads_by_mail()}
          </label>
        )}
        <span className="flex-1" />
        <Button type="submit" disabled={busy}>
          {m.threads_send()}
        </Button>
      </div>
      {note && <p className="text-body-sm text-fg-muted">{note}</p>}
    </form>
  );
}

function StateBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** The state of the thread's object, beside it: money, who holds what, members, proof. */
function ThreadState({
  view,
  money,
  shown,
  onClose,
}: {
  view: ThreadView;
  money: ProjectMoney | null;
  /** Below 1200 px the state folds; she opens it from the thread's head. */
  shown: boolean;
  onClose: () => void;
}) {
  const [proof, setProof] = useState<string | null>(null);
  const members = view.thread.members ?? [];
  return (
    <aside
      aria-label={m.threads_state()}
      className={`grid content-start gap-5 overflow-auto border-l border-line bg-surface p-4 ${
        shown
          ? 'max-[1200px]:fixed max-[1200px]:inset-y-0 max-[1200px]:right-0 max-[1200px]:z-30 max-[1200px]:w-[min(340px,100%)] max-[1200px]:shadow-xl'
          : 'max-[1200px]:hidden'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        className="hidden items-center justify-self-end gap-1 text-body-sm font-semibold text-link max-[1200px]:inline-flex"
      >
        <CanvasIcon name="x" size={14} />
        {m.common_close()}
      </button>
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
                <span className="font-mono text-state-verify-fg">{h.due ?? ageOf(h.since)}</span>
                <span className="col-span-2 text-[12px] text-fg-muted">
                  {view.names[h.holder.id] ?? h.holder.id}
                </span>
              </li>
            ))}
          </ul>
        )}
      </StateBlock>
      <StateBlock
        title={m.threads_members({ count: String(members.filter((mb) => !mb.until).length) })}
      >
        <ul className="grid gap-1">
          {members.map((mb) => (
            <li key={`${mb.id}-${mb.since}`} className="flex items-center gap-2 text-body-sm">
              <Avatar name={view.names[mb.id] ?? mb.id} kind={mb.kind} />
              <span className={`truncate ${mb.until ? 'text-fg-muted line-through' : ''}`}>
                {view.names[mb.id] ?? mb.id}
              </span>
              <span className="ml-auto text-[11.5px] text-fg-muted">
                {mb.id === view.thread.holder.id
                  ? m.threads_holds()
                  : m.threads_since({ day: dayOf(mb.since) })}
              </span>
            </li>
          ))}
        </ul>
      </StateBlock>
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

/** The whole screen: the list, the thread, its state. */
export function ThreadsScreen({
  threads,
  view,
  money,
  me,
}: {
  threads: Thread[];
  view: ThreadView | null;
  money: ProjectMoney | null;
  me: string;
}) {
  let lastDay = '';
  const [stateShown, setStateShown] = useState(false);
  return (
    <div className="grid h-full min-h-[560px] grid-cols-[240px_minmax(0,1fr)_320px] max-[1200px]:grid-cols-[240px_minmax(0,1fr)] max-[1000px]:grid-cols-1">
      <ThreadList threads={threads} current={view?.thread.id ?? null} />
      {view ? (
        <section aria-label={view.thread.title} className="flex min-h-0 min-w-0 flex-col bg-bg">
          <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
            <a
              href="/fils?liste=1"
              aria-label={m.threads_back()}
              className="hidden size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover max-[1000px]:inline-flex"
            >
              <CanvasIcon name="left" size={16} />
            </a>
            <div className="min-w-0 flex-1">
              <h1 className="text-[17px] font-semibold">{view.thread.title}</h1>
              <p className="text-body-sm text-fg-muted">
                {m.threads_held_by({
                  name: view.names[view.thread.holder.id] ?? view.thread.holder.id,
                })}
                {view.thread.state === 'closed' && ` · ${m.threads_closed()}`}
              </p>
            </div>
            <button
              type="button"
              aria-pressed={stateShown}
              onClick={() => setStateShown((open) => !open)}
              className="hidden h-(--control-height) items-center gap-1.5 rounded-control border border-line-control px-2.5 text-body-sm font-semibold max-[1200px]:inline-flex"
            >
              <CanvasIcon name="layers" size={14} />
              {m.threads_state()}
            </button>
          </header>
          <ol className="flex flex-1 flex-col gap-4 overflow-auto p-4" aria-live="polite">
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
                      names={view.names}
                      mine={message.author.kind === 'person' && message.author.id === me}
                    />
                  </ul>
                </li>
              );
            })}
          </ol>
          {view.thread.state === 'open' && <Composer view={view} me={me} />}
        </section>
      ) : (
        <section className="grid place-items-center p-8 text-center text-fg-muted">
          <p>{threads.length === 0 ? m.threads_none_yet() : m.threads_pick()}</p>
        </section>
      )}
      {view && (
        <ThreadState
          view={view}
          money={money}
          shown={stateShown}
          onClose={() => setStateShown(false)}
        />
      )}
    </div>
  );
}
