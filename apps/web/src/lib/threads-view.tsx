import {
  ConversationFrame,
  MessageItem,
  MessageStream,
  PinBar,
  ThreadHeader,
  ThreadInfo,
  ThreadListPanel,
  type ConversationWords,
  type ListItem,
  type MenuItem,
  type ShownMessage,
} from '@kete/conversation';
import {
  Button,
  CanvasIcon,
  DecisionCard,
  FieldToggle,
  MessageField,
  Tag,
  type FieldFile,
  type FieldPick,
  type FieldPicked,
  type MessageFieldWords,
} from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ageOf } from '@/lib/for-me-view';
import {
  AgentHead,
  AgentSidePanel,
  PauseAgent,
  Requests,
  RoutineBanner,
} from '@/lib/agent-colleague';
import { AnswerTable } from '@/lib/chat/answer-table';
import { FromPage, InviteToKete, KeteSide, Proposals, TurnAtWork } from '@/lib/kete-door';
import { refusal } from '@/lib/forms';
import { shownMoney } from '@/lib/money';
import type { ProjectMoney } from '@/lib/project-money';
import {
  actionDone,
  changeMembers,
  decideOutside,
  deleteInThread,
  draftFromMessage,
  editInThread,
  exportProof,
  fetchMedia,
  fetchPage,
  findObjects,
  importIntoThread,
  markThreadUnread,
  mergeThreads,
  moveInThreads,
  openGroup,
  pinInThread,
  postToThread,
  reactTo,
  searchThreads,
  sendThreadFile,
  sendVoice,
  setNotifyLevel,
  shareInThread,
  typingIn,
  type Found,
  type Message,
  type NotifyLevel,
  type ThreadHolding,
  type ThreadMedia,
  type ThreadSummary,
  type ThreadView,
} from '@/lib/threads';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// The threads screen (doctrine D-057, D-061; specs 090, 098, 099), drawn by @kete/conversation
// against the canvas v6.2: her threads on the left, the conversation in the middle — live, with
// photos, voice notes, « # » citations, reactions, Kete's turn in folded steps —, its object's
// state or « Infos du fil » on the right. The composer is @kete/design's one field.

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
  return date.toDateString() === new Date().toDateString()
    ? hour(iso)
    : new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(date);
};
const dueDay = (day: string) =>
  new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long' }).format(
    new Date(`${day}T12:00:00Z`),
  );

/** Every word of @kete/conversation, in the app's language. */
export function threadsWords(): ConversationWords {
  return conversationWords();
}

function conversationWords(): ConversationWords {
  return {
    time: hour,
    day: dayOf,
    someone: m.threads_someone(),
    agent: m.threads_agent(),
    kete: 'Kete',
    newMessages: m.threads_new_messages(),
    jumpToNew: (count) => m.threads_jump_new({ count: String(count) }),
    older: m.threads_older(),
    typing: (names) => m.threads_typing({ names: names.join(', ') }),
    readBy: (readers) => m.threads_read_by({ who: readers.join(' · ') }),
    sent: m.threads_sent(),
    edited: m.threads_edited(),
    showOriginal: m.threads_show_original(),
    movedHere: m.threads_moved_here(),
    movedAway: m.threads_moved_away(),
    deleted: (name) => m.threads_deleted({ name }),
    imported: m.threads_imported(),
    onlyForYou: m.threads_only_for_you(),
    onlyForYouWhy: m.threads_only_for_you_why(),
    share: m.threads_share(),
    shared: m.threads_shared(),
    via: {
      whatsapp: m.threads_via_whatsapp(),
      mail: m.threads_via_mail(),
      telegram: m.threads_via_telegram(),
      form: m.threads_via_form(),
    },
    toClient: m.threads_to_client(),
    internal: m.threads_internal(),
    forAction: m.threads_for_action(),
    forInformation: m.threads_for_information(),
    reply: m.threads_reply(),
    react: (emoji) => m.threads_react({ emoji }),
    more: m.threads_more(),
    close: m.threads_close(),
    transcript: m.threads_transcript(),
    play: m.threads_play(),
    speed: m.threads_speed(),
    replyingTo: (name) => m.threads_replying({ name }),
    steps: m.threads_steps(),
    fold: m.threads_fold(),
    stop: m.threads_stop(),
    infos: m.threads_infos(),
    state: m.threads_state(),
    searchThread: m.threads_search_thread(),
    notifications: m.threads_notifications(),
    notifyLevel: {
      all: m.threads_notify_all(),
      mentions: m.threads_notify_mentions(),
      none: m.threads_notify_none(),
    },
    notifyHint: m.threads_notify_hint(),
    categories: {
      pins: m.threads_cat_pins(),
      photos: m.threads_cat_photos(),
      documents: m.threads_cat_documents(),
      links: m.threads_cat_links(),
      voices: m.threads_cat_voices(),
      actions: m.threads_cat_actions(),
      decisions: m.threads_cat_decisions(),
      members: m.threads_cat_members(),
    },
    nothingHere: m.threads_nothing_here(),
    version: (n) => m.threads_version({ n: String(n) }),
    list: m.threads_list(),
    back: m.threads_back(),
    states: {
      needs: m.threads_state_needs(),
      working: m.threads_state_working(),
      finished: m.threads_state_finished(),
      idle: m.threads_state_idle(),
    },
    resolved: m.threads_resolved(),
    unread: (count) => m.threads_unread({ count: String(count) }),
  };
}

function fieldWords(title: string, placeholder?: string): MessageFieldWords {
  return {
    field: m.threads_write(),
    placeholder: placeholder ?? m.threads_field_placeholder({ title }),
    send: m.threads_send(),
    stop: m.threads_stop(),
    add: m.threads_field_add(),
    attach: m.threads_field_attach(),
    mention: m.threads_mention(),
    cite: m.threads_field_cite(),
    emoji: m.threads_field_emoji(),
    moreEmoji: m.threads_field_more_emoji(),
    remove: m.threads_field_remove(),
    cancelReply: m.threads_field_cancel_reply(),
    record: m.threads_field_record(),
    recording: m.threads_field_recording(),
    cancelRecording: m.threads_field_cancel_recording(),
    sendRecording: m.threads_field_send_recording(),
    dictate: m.threads_field_dictate(),
  };
}

const projectStatus: Record<string, () => string> = {
  open: m.project_status_open,
  delivered: m.project_status_delivered,
  closed: m.project_status_closed,
};
const partyRole: Record<string, () => string> = {
  client: m.party_role_client,
  supplier: m.party_role_supplier,
  funder: m.party_role_funder,
  partner: m.party_role_partner,
};

/** A cited object's state, in her words: a project's status, a third party's roles. */
function stateWord(kind: string, state: string) {
  if (kind === 'project') return projectStatus[state]?.() ?? state;
  if (kind === 'party') {
    return state
      .split(', ')
      .map((role) => partyRole[role]?.() ?? role)
      .join(', ');
  }
  return state;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Her threads, live: a change reloads what the screen shows; who is writing shows at once. */
function useLive(me: string, current: string | null, onTyping: (who: string) => void) {
  const router = useRouter();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/fils/flux');
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener('thread', (event) => {
      let change: { threadId?: string; kind?: string; who?: { id: string } } = {};
      try {
        change = JSON.parse((event as MessageEvent<string>).data) as typeof change;
      } catch {
        // An older server says only that something changed.
      }
      if (change.kind === 'typing') {
        if (change.threadId === current && change.who && change.who.id !== me)
          onTyping(change.who.id);
        return;
      }
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
  }, [router, me, current, onTyping]);
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
    <div className="mb-1 grid gap-1">
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
          className="h-[30px] w-full rounded-[6px] border border-line-control bg-surface-control pr-2 pl-7 text-[12.5px]"
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

const initials = (title: string) =>
  title
    .split(/[\s—-]+/)
    .filter((w) => /\p{L}/u.test(w.charAt(0)))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

function sectionsOf(threads: ThreadSummary[], names: Record<string, string>) {
  const item = (t: ThreadSummary): ListItem => {
    const author = t.last ? (names[t.last.author.id] ?? '') : '';
    return {
      id: t.thread.id,
      href: `/fils?fil=${t.thread.id}`,
      title: t.thread.title,
      badge:
        t.thread.kind === 'kete'
          ? { text: '', tone: 'agent' }
          : t.thread.kind === 'object'
            ? {
                text: initials(t.thread.title),
                tone: t.thread.object?.kind === 'party' ? 'party' : 'object',
              }
            : { text: '#', tone: 'group' },
      last: t.last ? `${author} : ${t.last.text || '🎤'}` : m.threads_empty_short(),
      when: when(t.lastAt),
      unread: t.unread,
      resolved: t.openActions === 0 && t.thread.kind === 'object',
    };
  };
  const open = threads.filter((t) => t.thread.state === 'open');
  return [
    {
      label: m.threads_active(),
      items: open.filter((t) => t.thread.kind === 'object' || t.thread.kind === 'kete').map(item),
    },
    { label: m.threads_groups(), items: open.filter((t) => t.thread.kind === 'group').map(item) },
    { label: m.threads_direct(), items: open.filter((t) => t.thread.kind === 'direct').map(item) },
    {
      label: m.threads_put_away(),
      items: threads.filter((t) => t.thread.state === 'closed').map(item),
    },
  ].filter((section) => section.items.length > 0);
}

// --- A message's own blocks ----------------------------------------------------------------------

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
      data-done={done || undefined}
      className="mt-1.5 flex max-w-[620px] flex-wrap items-center gap-2 rounded-[7px] border border-state-verify-fg/40 bg-state-verify-surface px-2 py-1 text-body-sm data-[done]:border-line data-[done]:bg-transparent data-[done]:text-fg-muted"
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

function PendingBlock({
  message,
  pending,
  names,
  me,
}: {
  message: Message;
  pending: ThreadView['pending'][string];
  names: Record<string, string>;
  me: string;
}) {
  const router = useRouter();
  const decide = (approve: boolean) =>
    void decideOutside({ data: { messageId: message.first, approve } }).then(() =>
      router.invalidate(),
    );
  return (
    <div className="mt-1.5 flex max-w-[620px] flex-wrap items-center gap-2 rounded-[7px] border border-line px-2 py-1 text-body-sm">
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
          <Button onClick={() => decide(true)}>{m.threads_outside_approve()}</Button>
          <Button variant="secondary" onClick={() => decide(false)}>
            {m.threads_outside_refuse()}
          </Button>
        </>
      )}
    </div>
  );
}

/** « Créer… »: Kete prepares, from a message, the draft she asks for. */
function CreateFrom({ message, onDone }: { message: Message; onDone: (note: string) => void }) {
  const [what, setWhat] = useState('');
  return (
    <form
      className="mt-1.5 grid max-w-[520px] gap-2 rounded-[8px] border border-line bg-surface p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void draftFromMessage({ data: { messageId: message.first, what } }).then((answer) =>
          onDone(answer.ok ? m.threads_create_asked() : refusal(answer.error)),
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
      <span className="flex gap-2">
        <Button type="submit" disabled={what.trim().length < 2}>
          {m.threads_create_ask()}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onDone('')}>
          {m.common_cancel()}
        </Button>
      </span>
    </form>
  );
}

function MoveTo({
  message,
  threads,
  onDone,
}: {
  message: Message;
  threads: ThreadSummary[];
  onDone: (note: string) => void;
}) {
  const router = useRouter();
  return (
    <div className="mt-1.5 grid max-w-[360px] gap-0.5 rounded-[8px] border border-line bg-surface p-1.5">
      <span className="px-1 text-[11px] font-semibold text-fg-muted uppercase">
        {m.threads_move_to()}
      </span>
      {threads
        .filter((t) => t.thread.id !== message.thread && t.thread.state === 'open')
        .map((t) => (
          <button
            key={t.thread.id}
            type="button"
            className="truncate rounded-control px-2 py-1 text-left text-body-sm hover:bg-surface-hover"
            onClick={() =>
              void moveInThreads({ data: { messageId: message.first, to: t.thread.id } }).then(
                async (answer) => {
                  if (!answer.ok) return onDone(refusal(answer.error));
                  onDone('');
                  await router.invalidate();
                },
              )
            }
          >
            {t.thread.title}
          </button>
        ))}
    </div>
  );
}

function EditInPlace({ message, onDone }: { message: Message; onDone: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(message.text);
  return (
    <form
      className="mt-1.5 grid max-w-[620px] gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void editInThread({ data: { messageId: message.id, text: draft } }).then(async (a) => {
          if (a.ok) {
            onDone();
            await router.invalidate();
          }
        });
      }}
    >
      <textarea
        aria-label={m.threads_edit()}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        className="min-h-16 rounded-control border border-line-strong bg-control p-2"
      />
      <span className="flex gap-2">
        <Button type="submit">{m.threads_keep_edit()}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {m.common_cancel()}
        </Button>
      </span>
      <span className="text-body-sm text-fg-muted">{m.threads_edit_keeps()}</span>
    </form>
  );
}

// --- The composer -------------------------------------------------------------------------------

function Composer({
  view,
  me,
  people,
  replyTo,
  onReplyDone,
  onEditLast,
  forAction,
  onForAction,
  onTurn,
}: {
  view: ThreadView;
  me: string;
  people: Person[];
  replyTo: Message | null;
  onReplyDone: () => void;
  onEditLast: () => void;
  forAction: boolean;
  onForAction: (on: boolean) => void;
  /** Kete took its turn after her message. */
  onTurn: (turnId: string) => void;
}) {
  const kete = view.thread.kind === 'kete';
  // Her thread « Kete », or an agent's: words to it, without « internal » or « for action ».
  const plain = kete || view.agent !== null;
  const router = useRouter();
  const [to, setTo] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [outside, setOutside] = useState(false);
  const [files, setFiles] = useState<FieldFile[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const cited = useRef(new Map<string, { kind: string; id: string; app?: string }>());
  const last = view.messages.at(-1);
  useEffect(() => {
    if (last?.author.kind === 'agent') setNote(null);
  }, [last?.first, last?.author.kind]);
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
  const candidates = useMemo(() => {
    const known = new Map<string, Person>([[KETE, { id: KETE, name: 'Kete' }]]);
    for (const mb of members) known.set(mb.id, { id: mb.id, name: view.names[mb.id] ?? mb.id });
    for (const p of people) if (p.id !== me) known.set(p.id, p);
    return [...known.values()];
  }, [members, people, view.names, me]);

  const search = useCallback(
    async (trigger: '@' | '#' | '/', query: string): Promise<FieldPick[]> => {
      if (trigger === '@') {
        return candidates
          .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
          .map((c) => ({ id: c.id, label: c.name }));
      }
      if (trigger !== '#' || query.length < 1) return [];
      const objects = await findObjects({ data: { q: query } });
      return objects.map((o) => {
        const key = `${o.kind}:${o.id}:${o.app ?? ''}`;
        cited.current.set(key, { kind: o.kind, id: o.id, ...(o.app ? { app: o.app } : {}) });
        return {
          id: key,
          label: o.label,
          ...(o.state ? { hint: stateWord(o.kind, o.state) } : {}),
        };
      });
    },
    [candidates],
  );

  async function attach(list: File[]) {
    for (const file of list) {
      const temporary = `sending-${file.name}-${Date.now()}`;
      setFiles((f) => [
        ...f,
        {
          id: temporary,
          name: file.name,
          state: 'sending',
          kind: file.type.startsWith('image/')
            ? 'image'
            : file.type.startsWith('audio/')
              ? 'audio'
              : 'file',
        },
      ]);
      const answer = await sendThreadFile({
        data: {
          threadId: view.thread.id,
          name: file.name,
          contentType: file.type,
          data: await toBase64(file),
        },
      });
      setFiles((f) =>
        f.map((x) =>
          x.id !== temporary
            ? x
            : answer.ok
              ? { ...x, id: answer.data.file.id, state: 'ready' }
              : { ...x, state: 'failed' },
        ),
      );
      if (!answer.ok) setNote(refusal(answer.error));
    }
  }

  const reset = () => {
    setFiles([]);
    onForAction(false);
    setTo('');
    setDue('');
    setPriority('normal');
    setOutside(false);
    onReplyDone();
  };

  async function send(text: string, picked: FieldPicked[]) {
    setNote(null);
    const mentions = picked.filter((p) => p.trigger === '@').map((p) => p.id);
    const references = picked
      .filter((p) => p.trigger === '#')
      .map((p) => cited.current.get(p.id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const answer = await postToThread({
      data: {
        threadId: view.thread.id,
        text,
        for: forAction ? 'action' : 'information',
        ...(forAction && to ? { to } : {}),
        ...(forAction && due ? { due } : {}),
        ...(forAction ? { priority } : {}),
        ...(replyTo ? { replyTo: replyTo.first } : {}),
        mentions,
        references,
        files: files.filter((f) => f.state === 'ready').map((f) => f.id),
        visibility: outside ? 'outside' : 'internal',
      },
    });
    if (!answer.ok) {
      setNote(refusal(answer.error));
      return false;
    }
    reset();
    const { delivered, waiting } = answer.data;
    if (waiting.length > 0) setNote(m.threads_outside_asked());
    else if (delivered) {
      const reached = [...delivered.mailed, ...delivered.chat.sent, ...delivered.chat.byTemplate];
      setNote(
        delivered.chat.refused.some((r) => r.reason === 'no_channel')
          ? m.threads_outside_no_channel()
          : delivered.chat.refused.length > 0
            ? m.threads_outside_window()
            : reached.length > 0
              ? m.threads_mailed({ to: reached.join(', ') })
              : m.threads_outside_nobody(),
      );
    }
    if (answer.data.turn) onTurn(answer.data.turn);
    else if (mentions.includes(KETE)) setNote(m.threads_kete_thinking());
    await router.invalidate();
    return true;
  }

  const below = (
    <>
      {forAction && (
        <p className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5 text-[12.5px] font-semibold text-state-verify-fg">
          <CanvasIcon name="ok" size={13} />
          <span>{m.threads_who_acts()}</span>
          <select
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="h-[26px] rounded-full border border-line-control bg-surface px-2 text-[12.5px] text-fg"
          >
            <option value="">{m.threads_holder_acts()}</option>
            {members.map((mb) => (
              <option key={mb.id} value={mb.id}>
                {view.names[mb.id] ?? mb.id}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label={m.threads_by_when()}
            value={due}
            onChange={(event) => setDue(event.target.value)}
            className="h-[26px] rounded-full border border-line-control bg-surface px-2 text-[12.5px] text-fg"
          />
          <select
            aria-label={m.threads_how_urgent()}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className="h-[26px] rounded-full border border-line-control bg-surface px-2 text-[12.5px] text-fg"
          >
            {(['urgent', 'high', 'normal', 'low'] as const).map((p) => (
              <option key={p} value={p}>
                {priorityWord[p]?.()}
              </option>
            ))}
          </select>
        </p>
      )}
      {outside && (
        <p className="flex items-start gap-1.5 px-3 pb-1.5 text-[12px] font-semibold text-state-verify-fg">
          <CanvasIcon name="whatsapp" size={13} />
          {m.threads_outside_line({ channels: channels.join(', ') })}
        </p>
      )}
      {outside && !view.mailbox && contacts.some((c) => c.id.startsWith('mail:')) && (
        <p className="px-3 pb-1.5 text-[12px] text-state-verify-fg">{m.threads_no_mailbox()}</p>
      )}
    </>
  );

  return (
    <div className="flex-none border-t border-line bg-surface px-4 pt-2 pb-3 max-[860px]:px-2.5">
      <MessageField
        words={fieldWords(
          view.thread.title,
          kete
            ? m.door_placeholder()
            : view.agent
              ? m.colleague_placeholder({ name: view.agent.name })
              : undefined,
        )}
        draftKey={view.thread.id}
        triggers={['@', '#']}
        search={search}
        emojis={['👍', '✅', '🙏', '👀', '😂', '❤️', '🎉', '⚠️']}
        files={{
          items: files,
          onFiles: (list) => void attach(list),
          onRemove: (id) => setFiles((f) => f.filter((x) => x.id !== id)),
        }}
        voice={{
          onRecorded: (audio, durationMs) =>
            void toBase64(audio).then((data) =>
              sendVoice({
                data: {
                  threadId: view.thread.id,
                  data,
                  contentType: audio.type || 'audio/webm',
                  durationMs,
                  ...(replyTo ? { replyTo: replyTo.first } : {}),
                },
              }).then(async (answer) => {
                if (!answer.ok) return setNote(m.threads_voice_failed());
                onReplyDone();
                await router.invalidate();
              }),
            ),
        }}
        reply={
          replyTo
            ? {
                text: `${m.threads_replying({ name: view.names[replyTo.author.id] ?? '' })} — ${replyTo.text}`,
                onCancel: onReplyDone,
              }
            : null
        }
        tone={outside ? 'alert' : 'plain'}
        below={below}
        toggles={
          plain ? undefined : (
            <>
              {contacts.length > 0 && (
                <FieldToggle
                  pressed={outside}
                  onToggle={() => setOutside((o) => !o)}
                  icon={outside ? 'whatsapp' : 'lock'}
                  title={m.threads_who_reads()}
                >
                  {outside ? m.threads_to_client_short() : m.threads_internal()}
                </FieldToggle>
              )}
              <FieldToggle
                pressed={forAction}
                onToggle={() => onForAction(!forAction)}
                icon="ok"
                title={m.threads_for_what()}
              >
                {forAction ? m.threads_for_action() : m.threads_for_information()}
              </FieldToggle>
            </>
          )
        }
        onTyping={() => void typingIn({ data: { threadId: view.thread.id } })}
        onEditLast={onEditLast}
        onSend={send}
        hint={note ?? m.threads_field_hint()}
      />
    </div>
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

function Avatar({ name, kind }: { name: string; kind: string }) {
  return (
    <span
      aria-hidden="true"
      data-kind={kind}
      className="inline-grid size-6 flex-none place-items-center rounded-full bg-surface-selected text-[10px] font-bold text-fg data-[kind=agent]:rounded-[5px] data-[kind=agent]:bg-agent data-[kind=agent]:text-on-agent data-[kind=contact]:bg-state-success-fg data-[kind=contact]:text-surface"
    >
      {kind === 'agent' ? <CanvasIcon name="bot" size={12} /> : initials(name) || '·'}
    </span>
  );
}

function Members({ view, me, people }: { view: ThreadView; me: string; people: Person[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState('');
  const members = (view.thread.members ?? []).filter((mb) => !mb.until);
  // A client reached on several channels is one member: one row, its channels said.
  const channelOf = (id: string) =>
    id.startsWith('whatsapp:')
      ? m.threads_channel_whatsapp()
      : id.startsWith('telegram:')
        ? m.threads_channel_telegram()
        : id.startsWith('mail:')
          ? m.threads_channel_mail()
          : '';
  const rows: { member: (typeof members)[number]; channels: string[] }[] = [];
  for (const mb of members) {
    const same =
      mb.kind === 'contact'
        ? rows.find(
            (r) => r.member.kind === 'contact' && view.names[r.member.id] === view.names[mb.id],
          )
        : undefined;
    if (same) same.channels.push(channelOf(mb.id));
    else rows.push({ member: mb, channels: mb.kind === 'contact' ? [channelOf(mb.id)] : [] });
  }
  const holder = view.thread.holder.id === me;
  const addable = people.filter((p) => !members.some((mb) => mb.id === p.id));
  const change = (body: { add?: string[]; remove?: string[] }) =>
    void changeMembers({ data: { threadId: view.thread.id, ...body } }).then(() =>
      router.invalidate(),
    );
  return (
    <StateBlock title={m.threads_members({ count: String(rows.length) })}>
      <ul className="grid gap-1">
        {rows.map(({ member: mb, channels }) => (
          <li key={`${mb.id}-${mb.since}`} className="flex items-center gap-2 text-body-sm">
            <Avatar name={view.names[mb.id] ?? ''} kind={mb.kind} />
            <span className="truncate">{view.names[mb.id] ?? m.threads_someone()}</span>
            <span className="ml-auto text-[11.5px] text-fg-muted">
              {mb.id === view.thread.holder.id
                ? m.threads_holds()
                : mb.role === 'subscriber'
                  ? m.threads_subscriber()
                  : channels.filter(Boolean).length
                    ? channels.filter(Boolean).join(' · ')
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

/** The thread's other gestures: import a conversation from elsewhere, merge into another thread. */
function Elsewhere({
  view,
  threads,
  me,
}: {
  view: ThreadView;
  threads: ThreadSummary[];
  me: string;
}) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  return (
    <StateBlock title={m.threads_import()}>
      <input
        ref={picker}
        type="file"
        accept=".txt,.json,.eml,text/plain,application/json,message/rfc822"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          const kind = file.name.endsWith('.json')
            ? 'telegram'
            : file.name.endsWith('.eml')
              ? 'eml'
              : 'whatsapp';
          void toBase64(file).then((data) =>
            importIntoThread({ data: { threadId: view.thread.id, kind, data } }).then(
              async (answer) => {
                if (!answer.ok) return setNote(refusal(answer.error));
                const done = answer.data;
                setNote(
                  [
                    m.threads_imported_done({
                      imported: String(done.imported),
                      skipped: String(done.skipped),
                      recognized: String(done.recognized),
                    }),
                    done.unknown.length > 0
                      ? m.threads_imported_unknown({ names: done.unknown.join(', ') })
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                );
                await router.invalidate();
              },
            ),
          );
        }}
      />
      <Button variant="secondary" onClick={() => picker.current?.click()}>
        <CanvasIcon name="import" size={13} /> {m.threads_import()}
      </Button>
      <p className="text-[11.5px] text-fg-muted">{m.threads_import_hint()}</p>
      {view.thread.holder.id === me &&
        (merging ? (
          <div className="grid gap-0.5">
            {threads
              .filter((t) => t.thread.id !== view.thread.id && t.thread.state === 'open')
              .map((t) => (
                <button
                  key={t.thread.id}
                  type="button"
                  className="truncate rounded-control px-2 py-1 text-left text-body-sm hover:bg-surface-hover"
                  onClick={() =>
                    void mergeThreads({
                      data: { threadId: view.thread.id, into: t.thread.id },
                    }).then((answer) => {
                      if (!answer.ok) return setNote(refusal(answer.error));
                      window.location.href = `/fils?fil=${t.thread.id}`;
                    })
                  }
                >
                  {t.thread.title}
                </button>
              ))}
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setMerging(true)}>
            <CanvasIcon name="merge" size={13} /> {m.threads_merge()}
          </Button>
        ))}
      {note && <p className="text-body-sm text-fg-muted">{note}</p>}
    </StateBlock>
  );
}

function ThreadState({
  view,
  money,
  me,
  people,
  threads,
}: {
  view: ThreadView;
  money: ProjectMoney | null;
  me: string;
  people: Person[];
  threads: ThreadSummary[];
}) {
  const [proof, setProof] = useState<string | null>(null);
  return (
    <>
      <span className="flex flex-wrap gap-1.5">
        {view.link && (
          <a
            href={view.link}
            target={view.link.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-center text-body-sm font-semibold text-link"
          >
            <CanvasIcon name="ext" size={13} /> {m.threads_open_object()}
          </a>
        )}
      </span>
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
      <Elsewhere view={view} threads={threads} me={me} />
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
    </>
  );
}

function Cards({ view, me }: { view: ThreadView; me: string }) {
  if (view.cards.length === 0) return null;
  return (
    <div className="grid flex-none gap-2 border-b border-line bg-surface px-4 py-3">
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

/** The whole screen: the list, the thread, its state or « Infos du fil ». */
export function ThreadsScreen({
  threads,
  names,
  view,
  money,
  me,
  people,
  solo = false,
  agents,
  empty,
}: {
  threads: ThreadSummary[];
  names: Record<string, string>;
  view: ThreadView | null;
  money: ProjectMoney | null;
  me: string;
  people: Person[];
  /** Her thread « Kete » alone, without the list (canvas v6.2, « Fil Kete »). */
  solo?: boolean;
  /** « Mes agents »: her agents by state instead of her threads (canvas v6.2, « Les agents »). */
  agents?: { list: ReactNode };
  /** What the middle shows when no thread is open. */
  empty?: ReactNode;
}) {
  const router = useRouter();
  const [asked, setAsked] = useState<string | null>(null);
  const words = useMemo(conversationWords, []);
  const [asideShown, setAsideShown] = useState(false);
  const [infos, setInfos] = useState(false);
  const [media, setMedia] = useState<ThreadMedia | null>(null);
  const [level, setLevel] = useState<NotifyLevel>(view?.level ?? 'all');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forAction, setForAction] = useState(false);
  const [open, setOpen] = useState<{ id: string; what: 'edit' | 'create' | 'move' } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [older, setOlder] = useState<{ messages: Message[]; more: boolean } | null>(null);
  const [extraNames, setExtraNames] = useState<Record<string, string>>({});
  const [extraCited, setExtraCited] = useState<
    Record<string, { label: string; state: string | null }>
  >({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const current = view?.thread.id ?? null;

  useEffect(() => {
    setAsked(null);
    setOlder(null);
    setMedia(null);
    setInfos(false);
    setReplyTo(null);
    setOpen(null);
    setLevel(view?.level ?? 'all');
  }, [current]);
  // What « Infos du fil » lists follows the thread: a message, a file, a pin.
  const mediaKey = (view?.messages ?? [])
    .map((msg) => `${msg.id}${msg.pinned ? '*' : ''}${msg.deleted ? '-' : ''}`)
    .join();
  useEffect(() => {
    if (!infos || !current) return;
    void fetchMedia({ data: { threadId: current } }).then((answer) => {
      setMedia(answer.media);
      setLevel(answer.level);
    });
  }, [infos, current, mediaKey]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((all) =>
        Object.fromEntries(Object.entries(all).filter(([, at]) => now - at < 5000)),
      );
    }, 1500);
    return () => clearInterval(timer);
  }, []);
  const onTyping = useCallback(
    (who: string) => setTyping((all) => ({ ...all, [who]: Date.now() })),
    [],
  );
  useLive(me, current, onTyping);

  const allNames = { ...names, ...(view?.names ?? {}), ...extraNames };
  const nameOf = (who: { id: string }) => (who.id === KETE ? 'Kete' : (allNames[who.id] ?? ''));
  const faceOf = (who: { id: string }) => view?.faces?.[who.id] ?? null;
  // Kete's other voices — the morning point, the briefing — are Kete, not an agent (D-061).
  const asKete = <T extends { author: { kind: string; id: string } }>(msg: T): T =>
    msg.author.kind === 'agent' && msg.author.id !== KETE && allNames[msg.author.id] === 'Kete'
      ? { ...msg, author: { kind: 'agent', id: KETE } }
      : msg;
  const messages = [...(older?.messages ?? []), ...(view?.messages ?? [])].map(asKete);
  const byId = new Map(
    messages.flatMap((msg) => [[msg.first, msg] as const, [msg.id, msg] as const]),
  );
  const cited = { ...(view?.cited ?? {}), ...extraCited };
  const openActions = view
    ? Object.values(view.actions).filter((a) => a.state !== 'done' && !a.doneAt).length
    : 0;
  const pinned = messages.filter((msg) => msg.pinned && !msg.deleted);
  const mine = (msg: Message) => msg.author.kind === 'person' && msg.author.id === me;

  const loadOlder = async (before: string, so: Message[]) => {
    if (!view) return { messages: so, more: false };
    const page = await fetchPage({ data: { threadId: view.thread.id, before } });
    setExtraNames((n) => ({ ...n, ...page.names }));
    setExtraCited((c) => ({ ...c, ...page.cited }));
    const next = { messages: [...page.messages, ...so], more: page.older };
    setOlder(next);
    return next;
  };

  /** « Chercher dans ce fil »: the first hit, its older pages loaded until it shows. */
  async function findInThread(text: string) {
    if (!view || text.trim().length < 2) return;
    const hit = (await searchThreads({ data: { q: text } })).find(
      (f) => f.thread === view.thread.id,
    );
    if (!hit) return;
    let loaded = { messages: older?.messages ?? [], more: older ? older.more : view.older };
    for (let pages = 0; pages < 20 && loaded.more; pages += 1) {
      const all = [...loaded.messages, ...view.messages];
      if (all.some((msg) => msg.id === hit.id || msg.first === hit.id)) break;
      const first = all[0];
      if (!first) break;
      loaded = await loadOlder(first.first, loaded.messages);
    }
    setAsideShown(false);
    window.location.hash = hit.id;
  }

  const menuOf = (msg: Message): MenuItem[] => {
    const holder = view?.thread.holder.id === me;
    const items: MenuItem[] = [
      {
        id: 'pin',
        label: msg.pinned ? m.threads_unpin() : m.threads_pin(),
        icon: 'pin',
        onSelect: () =>
          void pinInThread({ data: { messageId: msg.first, pinned: !msg.pinned } }).then(() =>
            router.invalidate(),
          ),
      },
      {
        id: 'create',
        label: m.threads_create_from(),
        icon: 'spark',
        onSelect: () => setOpen({ id: msg.first, what: 'create' }),
      },
      {
        id: 'unread',
        label: m.threads_mark_unread(),
        icon: 'read',
        onSelect: () =>
          void markThreadUnread({ data: { threadId: msg.thread, from: msg.first } }).then(() => {
            window.location.href = '/fils?liste=1';
          }),
      },
    ];
    if ((mine(msg) || holder) && !msg.movedTo) {
      items.push({
        id: 'move',
        label: m.threads_move(),
        icon: 'ext',
        onSelect: () => setOpen({ id: msg.first, what: 'move' }),
      });
    }
    if (mine(msg) && !msg.movedTo) {
      items.push(
        {
          id: 'edit',
          label: m.threads_edit(),
          icon: 'pen',
          onSelect: () => setOpen({ id: msg.first, what: 'edit' }),
        },
        {
          id: 'delete',
          label: m.threads_delete(),
          icon: 'trash',
          danger: true,
          onSelect: () => {
            if (!window.confirm(m.threads_delete_keeps())) return;
            void deleteInThread({ data: { messageId: msg.first } }).then(() => router.invalidate());
          },
        },
      );
    }
    return items;
  };

  const kete = view?.thread.kind === 'kete';
  const turn = asked ? { turnId: asked } : (view?.turn ?? null);
  const aside = view ? (
    infos ? (
      <ThreadInfo
        words={words}
        media={media}
        fileHref={(id) => `/api/fils/fichiers/${id}`}
        messageHref={(id) => `#${id}`}
        level={level}
        onLevel={(next) => {
          setLevel(next);
          void setNotifyLevel({ data: { threadId: view.thread.id, level: next } });
        }}
        onSearch={(text) => void findInThread(text)}
        actions={{
          count: `${openActions} / ${Object.keys(view.actions).length}`,
          node: (
            <ul className="grid gap-1 text-body-sm">
              {Object.entries(view.actions).map(([message, a]) => (
                <li key={a.holdingId}>
                  <a href={`#${message}`} className="hover:text-link">
                    {a.what} · {allNames[a.holder.id] ?? ''}
                  </a>
                </li>
              ))}
            </ul>
          ),
        }}
        decisions={{
          count: String(view.done.length),
          node: (
            <ul className="grid gap-1 text-body-sm text-fg-muted">
              {view.done.map((d) => (
                <li key={`${d.what}-${d.at}`}>{d.what}</li>
              ))}
            </ul>
          ),
        }}
        members={{
          count: String((view.thread.members ?? []).filter((mb) => !mb.until).length),
          node: <Members view={view} me={me} people={people} />,
        }}
        onState={() => setInfos(false)}
      />
    ) : kete ? (
      <KeteSide handed={view.handed} />
    ) : view.agent ? (
      <AgentSidePanel agent={view.agent} />
    ) : (
      <ThreadState view={view} money={money} me={me} people={people} threads={threads} />
    )
  ) : undefined;
  const conversation = view ? (
    <section aria-label={view.thread.title} className="flex min-h-0 min-w-0 flex-col bg-bg">
      <ThreadHeader
        words={words}
        title={view.thread.title}
        backHref="/fils?liste=1"
        onTitle={() => {
          setInfos(true);
          setAsideShown(true);
        }}
        subtitle={
          kete ? (
            m.door_subtitle()
          ) : view.agent ? (
            view.agent.mission
          ) : (
            <>
              {m.threads_held_by({
                name: allNames[view.thread.holder.id] ?? m.threads_someone(),
              })}
              {' · '}
              {openActions > 0
                ? m.threads_open_actions({ count: String(openActions) })
                : m.threads_nothing_waits()}
              {view.thread.state === 'closed' && ` · ${m.threads_closed()}`}
            </>
          )
        }
        actions={
          <>
            {kete && <InviteToKete threadId={view.thread.id} people={people} me={me} />}
            {view.agent && <AgentHead agent={view.agent} />}
            {view.agent && <PauseAgent agent={view.agent} />}
            <Button
              variant="secondary"
              onClick={() => {
                setInfos(true);
                setAsideShown(true);
              }}
            >
              <CanvasIcon name="more" size={13} />
              <span className="max-[520px]:sr-only">{m.threads_infos()}</span>
            </Button>
            <button
              type="button"
              aria-pressed={asideShown}
              onClick={() => {
                setInfos(false);
                setAsideShown((o) => !o);
              }}
              className="hidden h-(--control-height) items-center gap-1.5 rounded-control border border-line-control px-2.5 text-body-sm font-semibold max-[1180px]:inline-flex"
            >
              <CanvasIcon name="layers" size={14} />
              <span className="max-[520px]:sr-only">{m.threads_state()}</span>
            </button>
          </>
        }
      />
      {view.agent && <RoutineBanner agent={view.agent} />}
      <PinBar
        pins={pinned.map((msg) => ({
          id: msg.first,
          label: msg.text.slice(0, 60) || (msg.attachments?.[0]?.name ?? '📎'),
          href: `#${msg.first}`,
        }))}
      />
      <Cards view={view} me={me} />
      <MessageStream
        label={view.thread.title}
        words={words}
        messages={messages as ShownMessage[]}
        unreadFrom={view.unreadFrom}
        typing={Object.keys(typing).map((id) => allNames[id] ?? m.threads_someone())}
        older={older ? older.more : view.older}
        onOlder={() => {
          const first = messages[0];
          if (first) void loadOlder(first.first, older?.messages ?? []);
        }}
        empty={m.threads_empty()}
        renderMessage={(msg) => {
          const message = msg as Message;
          const action = view.actions[message.first];
          const pending = view.pending[message.first];
          const run = view.runs?.[message.id];
          const panel = open?.id === message.first ? open.what : null;
          return (
            <MessageItem
              key={message.first}
              message={msg}
              words={words}
              me={{ kind: 'person', id: me }}
              nameOf={nameOf}
              faceOf={faceOf}
              quoted={
                message.reply_to
                  ? (byId.get(message.reply_to) as ShownMessage | undefined)
                  : undefined
              }
              fileHref={(id) => `/api/fils/fichiers/${id}`}
              original={view.originals?.[message.first]}
              referenceLabel={(r) => cited[`${r.kind}:${r.id}`]?.label ?? r.id}
              renderReference={(r) => {
                const state = cited[`${r.kind}:${r.id}`];
                return (
                  <span className="inline-flex h-[22px] items-center gap-1 rounded-[5px] bg-state-info-surface px-1.5 text-[12.5px] font-semibold text-state-info-fg">
                    <CanvasIcon name="hash" size={12} />
                    {state?.label ?? r.id}
                    {state?.state && (
                      <span className="font-normal text-fg-soft">
                        {stateWord(r.kind, state.state)}
                      </span>
                    )}
                  </span>
                );
              }}
              run={
                run
                  ? {
                      title: run.title,
                      meta: run.seconds !== null ? `${run.seconds} s` : '',
                      steps: run.steps,
                    }
                  : null
              }
              extras={
                <>
                  {view.pages[message.first] && (
                    <FromPage page={view.pages[message.first] as { href: string; title: string }} />
                  )}
                  {run?.tables?.map((table, index) => (
                    <AnswerTable key={`${table.tool}-${index}`} table={table} />
                  ))}
                  {view.requests?.[message.first] && (
                    <Requests list={view.requests[message.first] ?? []} />
                  )}
                  {view.proposals[message.first] && (
                    <Proposals
                      list={view.proposals[message.first] ?? []}
                      names={allNames}
                      people={people}
                    />
                  )}
                  {action && <ActionBlock action={action} names={allNames} me={me} />}
                  {pending && (
                    <PendingBlock message={message} pending={pending} names={allNames} me={me} />
                  )}
                  {panel === 'edit' && (
                    <EditInPlace message={message} onDone={() => setOpen(null)} />
                  )}
                  {panel === 'create' && (
                    <CreateFrom
                      message={message}
                      onDone={(note) => {
                        setOpen(null);
                        if (note) setNotes((all) => ({ ...all, [message.first]: note }));
                      }}
                    />
                  )}
                  {panel === 'move' && (
                    <MoveTo
                      message={message}
                      threads={threads}
                      onDone={(note) => {
                        setOpen(null);
                        if (note) setNotes((all) => ({ ...all, [message.first]: note }));
                      }}
                    />
                  )}
                  {notes[message.first] && (
                    <p className="mt-1 text-body-sm text-fg-muted">{notes[message.first]}</p>
                  )}
                </>
              }
              quickEmojis={['👍', '✅', '👀']}
              onReact={(emoji) => {
                const on = !message.reactions.some(
                  (r) => r.emoji === emoji && r.by.some((who) => who.id === me),
                );
                void reactTo({ data: { messageId: message.first, emoji, on } }).then(() =>
                  router.invalidate(),
                );
              }}
              onReply={() => setReplyTo(message)}
              onAction={() => {
                setReplyTo(message);
                setForAction(true);
              }}
              {...(message.only_for
                ? {
                    onShare: () =>
                      void shareInThread({ data: { messageId: message.first } }).then(() =>
                        router.invalidate(),
                      ),
                  }
                : {})}
              menu={menuOf(message)}
            />
          );
        }}
      />
      <TurnAtWork
        threadId={view.thread.id}
        turn={turn}
        me={me}
        words={words}
        agent={view.agent?.name}
      />
      {view.thread.state === 'open' && (
        <Composer
          view={view}
          onTurn={setAsked}
          me={me}
          people={people}
          replyTo={replyTo}
          onReplyDone={() => setReplyTo(null)}
          forAction={forAction}
          onForAction={setForAction}
          onEditLast={() => {
            const last = [...messages]
              .reverse()
              .find((msg) => mine(msg) && !msg.deleted && !msg.movedTo);
            if (last) setOpen({ id: last.first, what: 'edit' });
          }}
        />
      )}
    </section>
  ) : (
    <section className="grid place-items-center p-8 text-center text-fg-muted max-[860px]:hidden">
      {empty ?? <p>{threads.length === 0 ? m.threads_none_yet() : m.threads_pick()}</p>}
    </section>
  );
  // Her thread « Kete » alone: the conversation and its side, the same aside as the frame's.
  if (solo) {
    return (
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden max-[1180px]:grid-cols-1">
        {conversation}
        {aside && (
          <aside
            aria-label={words.state}
            data-shown={asideShown || undefined}
            className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-line bg-surface p-3.5 pb-20 max-[1180px]:hidden max-[1180px]:data-[shown]:fixed max-[1180px]:data-[shown]:inset-y-0 max-[1180px]:data-[shown]:right-0 max-[1180px]:data-[shown]:z-30 max-[1180px]:data-[shown]:flex max-[1180px]:data-[shown]:w-[min(340px,100%)] max-[1180px]:data-[shown]:shadow-[-8px_0_30px_#0000001f]"
          >
            <button
              type="button"
              onClick={() => setAsideShown(false)}
              className="hidden items-center gap-1 self-end text-[12.5px] font-semibold text-link max-[1180px]:inline-flex"
            >
              <CanvasIcon name="x" size={14} />
              {words.close}
            </button>
            {aside}
          </aside>
        )}
      </div>
    );
  }
  return (
    <ConversationFrame
      words={words}
      asideShown={asideShown}
      onAsideClose={() => setAsideShown(false)}
      list={
        agents?.list ?? (
          <ThreadListPanel
            words={words}
            current={current}
            hidden={Boolean(view)}
            sections={sectionsOf(threads, allNames)}
            top={<ListTop people={people} me={me} />}
          />
        )
      }
      aside={aside}
    >
      {conversation}
    </ConversationFrame>
  );
}

function ListTop({ people, me }: { people: Person[]; me: string }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Search />
      {creating ? (
        <NewGroup people={people.filter((p) => p.id !== me)} onClose={() => setCreating(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <CanvasIcon name="plus" size={14} /> {m.threads_new_group()}
        </Button>
      )}
    </>
  );
}

export type { Thread } from '@/lib/threads';
