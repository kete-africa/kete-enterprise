import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';

// Threads (doctrine D-057; specs 089, 090, 098): one per object, groups, direct threads, her thread
// « Kete ». A trace at least as good as mail, and a place people live in: unread, live, members,
// mentions, files, quoted answers, actions with their holder, the object's cards, Kete in the thread.

export type Who = { kind: 'person' | 'agent' | 'contact'; id: string };

export interface Thread {
  id: string;
  kind: 'object' | 'group' | 'direct' | 'kete';
  object?: { kind: string; id: string };
  title: string;
  holder: { kind: 'person' | 'agent'; id: string };
  members?: (Who & { role?: 'member' | 'subscriber'; since: string; until?: string })[];
  address?: string;
  state: 'open' | 'closed';
  opened_at: string;
}

export interface ThreadSummary {
  thread: Thread;
  unread: number;
  last: { author: { kind: string; id: string }; text: string; at: string } | null;
  lastAt: string;
  openActions: number;
}

export interface Message {
  id: string;
  first: string;
  thread: string;
  author: Who;
  text: string;
  for: 'action' | 'information';
  to?: { kind: 'person' | 'agent'; id: string };
  via: 'kete' | 'whatsapp' | 'mail' | 'telegram' | 'form';
  visibility?: 'internal' | 'outside';
  reply_to?: string;
  moved_from?: string;
  movedTo?: { thread: string; message: string; at: string };
  mentions?: { kind: 'person' | 'agent'; id: string }[];
  edits: number;
  readBy: { kind: string; id: string; at: string }[];
  attachments?: { id: string; name: string; media_type?: string; bytes?: number }[];
  at: string;
}

export interface ThreadHolding {
  holdingId: string;
  what: string;
  holder: { kind: 'person' | 'agent'; id: string };
  state: string;
  since: string;
  due: string | null;
  priority: string;
  sourceKind: string;
  sourceRef: string;
  href: string | null;
  doneAt?: string | null;
}

export interface ThreadFiles {
  name: string;
  versions: {
    id: string;
    version: number;
    bytes: number;
    mediaType: string;
    by: string;
    at: string;
  }[];
}

export interface ThreadView {
  thread: Thread;
  messages: Message[];
  actions: Record<string, ThreadHolding>;
  pending: Record<
    string,
    { approvers: string[]; state: 'waiting' | 'sent' | 'refused'; decidedBy: string | null }
  >;
  holdings: ThreadHolding[];
  cards: ThreadHolding[];
  done: { what: string; holder: string; at: string }[];
  dates: { label: string; at: string | null }[];
  files: ThreadFiles[];
  link: string | null;
  names: Record<string, string>;
  mailbox: boolean;
}

export interface Found extends Message {
  threadTitle: string;
  authorName: string;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const threadId = (value: unknown) => {
  const id = text(value, 80);
  if (!/^thr_[0-9A-Za-z_-]{8,70}$/.test(id)) throw new Error('Which thread?');
  return id;
};
const messageId = (value: unknown) => {
  const id = text(value, 80);
  if (!/^msg_[0-9A-Za-z_-]{8,70}$/.test(id)) throw new Error('Which message?');
  return id;
};
const whoOf = (id: string) => ({
  kind: id.startsWith('agt_') ? ('agent' as const) : ('person' as const),
  id,
});
const ids = (value: unknown, max: number) =>
  Array.isArray(value)
    ? value
        .map((v) => text(v, 100))
        .filter(Boolean)
        .slice(0, max)
    : [];

export const fetchThreads = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ threads: ThreadSummary[]; names: Record<string, string> }>(getRequest(), '/v1/threads'),
);

export const fetchThread = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    threadId: threadId((input as { threadId?: unknown })?.threadId),
  }))
  .handler(({ data }) =>
    callApi<ThreadView>(getRequest(), `/v1/threads/${data.threadId}`).catch(() => null),
  );

/** An object's thread, if it has one (a project's, a third party's, an app's object…). */
export const fetchThreadOf = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { kind: text(v.kind, 60), id: text(v.id, 200) };
  })
  .handler(({ data }) =>
    callApi<{ thread: Thread }>(
      getRequest(),
      `/v1/threads/of/${encodeURIComponent(data.kind)}/${encodeURIComponent(data.id)}`,
    )
      .then((a) => a.thread)
      .catch(() => null),
  );

/** Her thread with Kete. */
export const fetchKeteThread = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ thread: Thread }>(getRequest(), '/v1/threads/kete').then((a) => a.thread),
);

/** Words in the threads she reads. */
export const searchThreads = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ q: text((input as { q?: unknown })?.q, 200) }))
  .handler(({ data }) =>
    data.q.length < 2
      ? Promise.resolve([] as Found[])
      : callApi<{ messages: Found[] }>(
          getRequest(),
          `/v1/threads/search?q=${encodeURIComponent(data.q)}`,
        ).then((a) => a.messages),
  );

export const postToThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const to = text(v.to, 100);
    const due = text(v.due, 10);
    const priority = text(v.priority, 10);
    const replyTo = text(v.replyTo, 80);
    return {
      threadId: threadId(v.threadId),
      text: text(v.text, 20000),
      for: v.for === 'action' ? ('action' as const) : ('information' as const),
      ...(to ? { to: whoOf(to) } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(due) ? { due } : {}),
      ...(['urgent', 'high', 'normal', 'low'].includes(priority) ? { priority } : {}),
      ...(replyTo ? { replyTo: messageId(replyTo) } : {}),
      mentions: ids(v.mentions, 50).map(whoOf),
      files: ids(v.files, 20),
      visibility: v.visibility === 'outside' ? ('outside' as const) : ('internal' as const),
    };
  })
  .handler(
    async ({
      data,
    }): Promise<
      GestureAnswer<{
        message: Message;
        holdingId: string | null;
        delivered: {
          mailed: string[];
          chat: { sent: string[]; byTemplate: string[]; refused: { to: string; reason: string }[] };
        } | null;
        waiting: string[];
      }>
    > => {
      const { threadId: id, ...body } = data;
      return sendGesture(getRequest(), `/v1/threads/${id}/messages`, body, crypto.randomUUID());
    },
  );

/** A file joins the thread (10 MB at most), sent as base64 like the assistant's. */
export const sendThreadFile = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      threadId: threadId(v.threadId),
      name: text(v.name, 200),
      contentType: text(v.contentType, 100) || 'application/octet-stream',
      data: typeof v.data === 'string' ? v.data : '',
    };
  })
  .handler(
    async ({
      data,
    }): Promise<GestureAnswer<{ file: { id: string; name: string; version: number } }>> => {
      const { threadId: id, ...body } = data;
      return sendGesture(getRequest(), `/v1/threads/${id}/files`, body, crypto.randomUUID());
    },
  );

export const editInThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { messageId: messageId(v.messageId), text: text(v.text, 20000) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ message: Message }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/messages/${data.messageId}/edit`,
      { text: data.text },
      crypto.randomUUID(),
    ),
  );

export const moveInThreads = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { messageId: messageId(v.messageId), to: threadId(v.to) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ message: Message }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/messages/${data.messageId}/move`,
      { to: data.to },
      crypto.randomUUID(),
    ),
  );

export const draftFromMessage = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { messageId: messageId(v.messageId), what: text(v.what, 120) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ asked: boolean }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/messages/${data.messageId}/draft`,
      { what: data.what },
      crypto.randomUUID(),
    ),
  );

export const decideOutside = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { messageId: messageId(v.messageId), approve: v.approve === true };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ state: string }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/messages/${data.messageId}/outside`,
      { approve: data.approve },
      crypto.randomUUID(),
    ),
  );

export const markThreadUnread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { threadId: threadId(v.threadId), from: messageId(v.from) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ ok: boolean }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/${data.threadId}/unread`,
      { from: data.from },
      crypto.randomUUID(),
    ),
  );

export const changeMembers = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      threadId: threadId(v.threadId),
      add: ids(v.add, 50).map(whoOf),
      remove: ids(v.remove, 50).map(whoOf),
    };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ thread: Thread }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/${data.threadId}/members`,
      { add: data.add, remove: data.remove },
      crypto.randomUUID(),
    ),
  );

export const actionDone = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const id = text((input as { holdingId?: unknown })?.holdingId, 80);
    if (!/^hld_[0-9A-Za-z_-]{4,70}$/.test(id)) throw new Error('Which action?');
    return { holdingId: id };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ holding: { holdingId: string } }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/actions/${data.holdingId}/done`,
      {},
      crypto.randomUUID(),
    ),
  );

export const openGroup = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { title: text(v.title, 200), members: ids(v.members, 200).map(whoOf) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ thread: Thread }>> =>
    sendGesture(
      getRequest(),
      '/v1/threads',
      { kind: 'group', title: data.title, members: data.members },
      crypto.randomUUID(),
    ),
  );

/** The proof: its journal's fingerprint (the PDF comes with the conversion service). */
export const exportProof = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    threadId: threadId((input as { threadId?: unknown })?.threadId),
  }))
  .handler(({ data }) =>
    callApi<{ fingerprint: string; journal: { messages: unknown[] } }>(
      getRequest(),
      `/v1/threads/${data.threadId}/export`,
    ).then((a) => ({ fingerprint: a.fingerprint, messages: a.journal.messages.length })),
  );

/** The people of the organization a member can be chosen from (its structure). */
export const fetchPeopleToAdd = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ people: { name: string; accountUserId: string | null }[] }>(
    getRequest(),
    '/v1/structure',
  )
    .then((chart) =>
      chart.people
        .filter((p) => p.accountUserId)
        .map((p) => ({ id: p.accountUserId as string, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    .catch(() => [] as { id: string; name: string }[]),
);
