import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';

// Threads (doctrine D-057; specs 089, 090): one per object, groups, direct threads, her thread
// « Kete ». A trace at least as good as mail: read by whom and when, for action or for information,
// an edit that keeps the original, members since when, the export as proof.

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

export interface Message {
  id: string;
  first: string;
  thread: string;
  author: Who;
  text: string;
  for: 'action' | 'information';
  to?: { kind: 'person' | 'agent'; id: string };
  via: 'kete' | 'whatsapp' | 'mail' | 'telegram' | 'form';
  edits: number;
  readBy: { kind: string; id: string; at: string }[];
  attachments?: { id: string; name: string }[];
  at: string;
}

export interface ThreadHolding {
  holdingId: string;
  what: string;
  holder: { kind: 'person' | 'agent'; id: string };
  state: string;
  since: string;
  due: string | null;
}

export interface ThreadView {
  thread: Thread;
  messages: Message[];
  holdings: ThreadHolding[];
  names: Record<string, string>;
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const threadId = (value: unknown) => {
  const id = text(value, 80);
  if (!/^thr_[0-9A-Za-z_-]{8,70}$/.test(id)) throw new Error('Which thread?');
  return id;
};

export const fetchThreads = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ threads: Thread[] }>(getRequest(), '/v1/threads').then((a) => a.threads),
);

export const fetchThread = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    threadId: threadId((input as { threadId?: unknown })?.threadId),
  }))
  .handler(({ data }) =>
    callApi<ThreadView>(getRequest(), `/v1/threads/${data.threadId}`).catch(() => null),
  );

/** An object's thread, if it has one (a project's, a third party's…). */
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

export const postToThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const to = text(v.to, 100);
    return {
      threadId: threadId(v.threadId),
      text: text(v.text, 20000),
      for: v.for === 'action' ? ('action' as const) : ('information' as const),
      ...(to
        ? { to: { kind: to.startsWith('agt_') ? ('agent' as const) : ('person' as const), id: to } }
        : {}),
      byMail: v.byMail !== false,
    };
  })
  .handler(
    async ({
      data,
    }): Promise<
      GestureAnswer<{ message: Message; holdingId: string | null; mailed: string[] }>
    > => {
      const { threadId: id, ...body } = data;
      return sendGesture(getRequest(), `/v1/threads/${id}/messages`, body, crypto.randomUUID());
    },
  );

export const editInThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const messageId = text(v.messageId, 80);
    if (!/^msg_[0-9A-Za-z_-]{8,70}$/.test(messageId)) throw new Error('Which message?');
    return { messageId, text: text(v.text, 20000) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ message: Message }>> =>
    sendGesture(
      getRequest(),
      `/v1/threads/messages/${data.messageId}/edit`,
      { text: data.text },
      crypto.randomUUID(),
    ),
  );

export const openGroup = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ title: text((input as { title?: unknown })?.title, 200) }))
  .handler(async ({ data }): Promise<GestureAnswer<{ thread: Thread }>> =>
    sendGesture(
      getRequest(),
      '/v1/threads',
      { kind: 'group', title: data.title, members: [] },
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
