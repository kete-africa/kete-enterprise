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
  /** The objects cited with « # » (spec 099). */
  references?: { kind: string; id: string; app?: string }[];
  only_for?: { kind: 'person'; id: string };
  edits: number;
  readBy: { kind: string; id: string; at: string }[];
  attachments?: {
    id: string;
    name: string;
    media_type?: string;
    bytes?: number;
    duration_ms?: number;
    transcript?: string;
  }[];
  reactions: { emoji: string; by: { kind: 'person' | 'agent' | 'contact'; id: string }[] }[];
  pinned?: { by: { kind: 'person' | 'agent' | 'contact'; id: string }; at: string };
  deleted?: { by: { kind: 'person' | 'agent' | 'contact'; id: string }; at: string };
  imported?: true;
  sharedAs?: string;
  at: string;
}

/** The turn of Kete or an agent that wrote a message (spec 099). */
export interface ThreadRun {
  title: string;
  steps: { state: 'done' | 'now' | 'todo' | 'ask'; label: string; tag?: string }[];
  seconds: number | null;
}

/** What a thread holds, for « Infos du fil » (spec 099, FR-002). */
export interface ThreadMedia {
  photos: { file: string; name: string; mediaType: string | null; message: string; at: string }[];
  documents: { file: string; name: string; message: string; at: string; version: number }[];
  links: { url: string; message: string; at: string }[];
  voices: {
    file: string;
    name: string;
    message: string;
    at: string;
    durationMs: number | null;
    transcript: string | null;
  }[];
  pins: { message: string; at: string }[];
}

export type NotifyLevel = 'all' | 'mentions' | 'none';

/** An object « # » offers, in its state of now. */
export interface CitableObject {
  kind: string;
  id: string;
  app?: string;
  label: string;
  state: string | null;
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
  /** There are older messages than this page. */
  older: boolean;
  /** The first message she had not read when she opened it. */
  unreadFrom: string | null;
  runs: Record<string, ThreadRun & { message_id: string }>;
  cited: Record<string, { label: string; state: string | null }>;
  level: NotifyLevel;
  /** What Kete proposed her under its messages (spec 099, FR-008 to FR-011). */
  proposals: Record<string, Proposal[]>;
  /** The page each of her questions to Kete was asked from, through the drawer. */
  pages: Record<string, { href: string; title: string }>;
  /** Kete's turn at work in this thread. */
  turn: Turn | null;
  /** A mail as it came, by message: what « voir l’original » shows (spec 099, FR-018). */
  originals: Record<string, string>;
  /** In her thread « Kete »: the parts her agents work for her. */
  handed: { agentId: string; name: string; part: string; state: AgentWorkState }[];
  /** In an agent's thread: its job description at work, beside it (spec 099, FR-016). */
  agent: AgentSide | null;
  /** What the agent asks, under its answers (FR-015). */
  requests: Record<string, AgentRequest[]>;
}

export type TakeOnLevel = 'never' | 'proposes' | 'alone';

export interface AgentSide {
  agentId: string;
  name: string;
  mission: string;
  status: 'active' | 'paused';
  person: { id: string; name: string } | null;
  mine: boolean;
  state: { kind: string; instruction?: string; steps?: number; drafts?: number; reason?: string };
  month: { done: number; asked: number; failed: number };
  permissions: { permission: string; level: number }[];
  autonomyMax: number;
  takeOn: Record<'described' | 'other' | 'mention', TakeOnLevel>;
  covers: string[];
  computerMinutes: number | null;
  computerUsed: number;
  returnTo: 'giver' | 'owner';
  trialUntil: string | null;
  routine: { time: string; cadence: 'daily' | 'weekdays'; instruction: string } | null;
  nextRoutineAt: string | null;
  wakeEveryMinutes: number;
  watches: string[];
  draftBudget: number;
}

export interface AgentRequest {
  draftId: string;
  capability: string;
  description: string;
  recordType: string;
  status: 'prepared' | 'validated' | 'refused';
  values: Record<string, string | number | boolean | null>;
  display: Record<string, string>;
  expiresAt: string | null;
  expired: boolean;
  always: boolean;
}

export interface AgentsScreen {
  agents: {
    agentId: string;
    name: string;
    threadId: string;
    state: AgentWorkState;
    asks: number;
    unread: number;
    line: string;
    mine: boolean;
  }[];
  together: { threadId: string; title: string; agents: string[] }[];
  working: number;
  needs: number;
}

export type AgentWorkState = 'needs' | 'working' | 'finished' | 'idle';

/** A turn of Kete at work: its steps and its words so far. */
export interface Turn {
  turnId: string;
  askedBy: string;
  steps: ThreadRun['steps'];
  live: string;
  startedAt: string;
}

export interface GestureSet {
  summary: string;
  object: { kind: 'project' | 'party'; id: string; title: string; thread: string | null } | null;
  holdings: {
    what: string;
    holder: string;
    due: string | null;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    returnTo: string;
    source: string | null;
  }[];
  dates: { label: string; day: string; source: string | null }[];
  routines: {
    title: string;
    prompt: string;
    cadence: 'daily' | 'weekdays' | 'weekly';
    weekday: number | null;
    time: string;
    source: string | null;
  }[];
}
export interface PolicyProposal {
  rule: string;
  template: string;
  policy: { id: string; sentence: string; set: 'authority' | 'approval'; approver?: string };
  simulation: { replayed: number; changed: number; byAgents: number };
}
export interface Handover {
  agentId: string;
  part: string;
  taskId?: string;
}

/** What Kete proposed: a set of gestures, a policy, or a part handed to one of her agents. */
export type Proposal = {
  proposalId: string;
  messageId: string;
  state: 'proposed' | 'confirmed' | 'declined' | 'trial' | 'adopted' | 'handed';
  proposedFor: string;
  /** What her decision made: the holdings, dates, routines — or the policy. */
  made: { holdings?: string[]; dates?: string[]; routines?: string[]; policyId?: string };
} & (
  | { kind: 'gestures'; body: GestureSet }
  | { kind: 'policy'; body: PolicyProposal }
  | {
      kind: 'handover';
      body: Handover;
      agent?: { name: string; state: AgentWorkState; step?: string };
    }
  | {
      kind: 'takeon';
      body: { agentId: string; agentName: string; holdingId: string; what: string };
    }
);

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
      references: (Array.isArray(v.references) ? v.references : [])
        .slice(0, 20)
        .map((r) => {
          const ref = (r ?? {}) as Record<string, unknown>;
          const app = text(ref.app, 60);
          return { kind: text(ref.kind, 60), id: text(ref.id, 200), ...(app ? { app } : {}) };
        })
        .filter((r) => r.kind && r.id),
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
        /** Kete's turn, when her message asked it or gave orders. */
        turn: string | null;
      }>
    > => {
      const { threadId: id, ...body } = data;
      return sendGesture(getRequest(), `/v1/threads/${id}/messages`, body, crypto.randomUUID());
    },
  );

/** A file joins the thread (100 MB at most), sent as base64 like the assistant's. */
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

// --- The threads at today's level (spec 099) ------------------------------------------------------

const gesture = <T>(path: string, body: object) =>
  sendGesture<T>(getRequest(), path, body, crypto.randomUUID());

/** Fifty messages before one, or around one a search found. */
export const fetchPage = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const before = text(v.before, 80);
    const around = text(v.around, 80);
    return {
      threadId: threadId(v.threadId),
      ...(before ? { before: messageId(before) } : {}),
      ...(around ? { around: messageId(around) } : {}),
    };
  })
  .handler(({ data }) => {
    const query = data.before
      ? `?before=${data.before}`
      : data.around
        ? `?around=${data.around}`
        : '';
    return callApi<{
      messages: Message[];
      older: boolean;
      newer: boolean;
      names: Record<string, string>;
      cited: Record<string, { label: string; state: string | null }>;
    }>(getRequest(), `/v1/threads/${data.threadId}/page${query}`);
  });

/** What a thread holds, and her notification level. */
export const fetchMedia = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    threadId: threadId((input as { threadId?: unknown })?.threadId),
  }))
  .handler(({ data }) =>
    callApi<{ media: ThreadMedia; level: NotifyLevel }>(
      getRequest(),
      `/v1/threads/${data.threadId}/media`,
    ),
  );

/** The objects « # » offers for what she typed. */
export const findObjects = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({ q: text((input as { q?: unknown })?.q, 80) }))
  .handler(({ data }) =>
    callApi<{ objects: CitableObject[] }>(
      getRequest(),
      `/v1/threads/objects?q=${encodeURIComponent(data.q)}`,
    ).then((a) => a.objects),
  );

export const reactTo = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { messageId: messageId(v.messageId), emoji: text(v.emoji, 16), on: v.on !== false };
  })
  .handler(({ data }) =>
    gesture<{ ok: true }>(`/v1/threads/messages/${data.messageId}/react`, {
      emoji: data.emoji,
      on: data.on,
    }),
  );

export const pinInThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { messageId: messageId(v.messageId), pinned: v.pinned !== false };
  })
  .handler(({ data }) =>
    gesture<{ ok: true }>(`/v1/threads/messages/${data.messageId}/pin`, { pinned: data.pinned }),
  );

export const deleteInThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    messageId: messageId((input as { messageId?: unknown })?.messageId),
  }))
  .handler(({ data }) =>
    gesture<{ ok: true }>(`/v1/threads/messages/${data.messageId}/delete`, {}),
  );

export const shareInThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    messageId: messageId((input as { messageId?: unknown })?.messageId),
  }))
  .handler(({ data }) =>
    gesture<{ message: Message }>(`/v1/threads/messages/${data.messageId}/share`, {}),
  );

export const setNotifyLevel = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const level = text(v.level, 10);
    return {
      threadId: threadId(v.threadId),
      level: (['all', 'mentions', 'none'].includes(level) ? level : 'all') as NotifyLevel,
    };
  })
  .handler(({ data }) =>
    gesture<{ level: NotifyLevel }>(`/v1/threads/${data.threadId}/notify`, { level: data.level }),
  );

/** She is writing: told to the thread, never kept. */
export const typingIn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    threadId: threadId((input as { threadId?: unknown })?.threadId),
  }))
  .handler(({ data }) => gesture<{ ok: true }>(`/v1/threads/${data.threadId}/typing`, {}));

/** A voice note, sent as base64, transcribed by Kete after. */
export const sendVoice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const replyTo = text(v.replyTo, 80);
    return {
      threadId: threadId(v.threadId),
      data: typeof v.data === 'string' ? v.data : '',
      contentType: text(v.contentType, 100) || 'audio/webm',
      durationMs: Math.max(0, Math.round(Number(v.durationMs) || 0)),
      ...(replyTo ? { replyTo: messageId(replyTo) } : {}),
    };
  })
  .handler(({ data }) => {
    const { threadId: id, ...body } = data;
    return gesture<{ message: Message; file: string }>(`/v1/threads/${id}/voice`, body);
  });

/** A WhatsApp or Telegram export, or a mail file, kept in the thread once. */
export const importIntoThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const kind = text(v.kind, 10);
    return {
      threadId: threadId(v.threadId),
      kind: (['whatsapp', 'telegram', 'eml'].includes(kind) ? kind : 'whatsapp') as
        'whatsapp' | 'telegram' | 'eml',
      data: typeof v.data === 'string' ? v.data : '',
    };
  })
  .handler(({ data }) => {
    const { threadId: id, ...body } = data;
    return gesture<{ imported: number; skipped: number; recognized: number; unknown: string[] }>(
      `/v1/threads/${id}/import`,
      body,
    );
  });

/** Two threads become one, by the holder of the first. */
export const mergeThreads = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { threadId: threadId(v.threadId), into: threadId(v.into) };
  })
  .handler(({ data }) =>
    gesture<{ moved: number }>(`/v1/threads/${data.threadId}/merge`, { into: data.into }),
  );

// --- Kete's door (spec 099, FR-007 to FR-011) -------------------------------------------------------

const proposalId = (value: unknown) => {
  const id = text(value, 80);
  if (!/^prp_[0-9A-Za-z_-]{8,70}$/.test(id)) throw new Error('Which proposal?');
  return id;
};

/** Kete's turn at work in a thread, if any. */
export const fetchTurn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    threadId: threadId((input as { threadId?: unknown })?.threadId),
  }))
  .handler(({ data }) =>
    callApi<{ turn: Turn | null }>(getRequest(), `/v1/threads/${data.threadId}/turn`).then(
      (a) => a.turn,
    ),
  );

/** « Arrêter »: the turn she asked stops; what was said stays. */
export const stopTurn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const id = text((input as { turnId?: unknown })?.turnId, 80);
    if (!/^(trn|tsk)_[0-9A-Za-z_-]{8,70}$/.test(id)) throw new Error('Which turn?');
    return { turnId: id };
  })
  .handler(({ data }) => gesture<{ stopped: true }>(`/v1/threads/turns/${data.turnId}/stop`, {}));

/** Her « oui » to a set of gestures: those she keeps, as she corrected them. */
export const confirmGestures = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const keep = Array.isArray(v.keep)
      ? v.keep.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0).slice(0, 40)
      : undefined;
    const edits: Record<string, { holder?: string; due?: string | null; priority?: string }> = {};
    for (const [index, edit] of Object.entries((v.edits ?? {}) as Record<string, unknown>)) {
      if (!/^\d{1,2}$/.test(index) || !edit || typeof edit !== 'object') continue;
      const e = edit as Record<string, unknown>;
      const due = text(e.due, 10);
      edits[index] = {
        ...(text(e.holder, 100) ? { holder: text(e.holder, 100) } : {}),
        ...(e.due === null ? { due: null } : /^\d{4}-\d{2}-\d{2}$/.test(due) ? { due } : {}),
        ...(['urgent', 'high', 'normal', 'low'].includes(text(e.priority, 10))
          ? { priority: text(e.priority, 10) }
          : {}),
      };
    }
    return { proposalId: proposalId(v.proposalId), ...(keep ? { keep } : {}), edits };
  })
  .handler(({ data }) => {
    const { proposalId: id, ...body } = data;
    return gesture<{ made: { holdings: string[]; dates: string[]; routines: string[] } }>(
      `/v1/threads/proposals/${id}/confirm`,
      body,
    );
  });

export const declineProposal = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    proposalId: proposalId((input as { proposalId?: unknown })?.proposalId),
  }))
  .handler(({ data }) =>
    gesture<{ declined: true }>(`/v1/threads/proposals/${data.proposalId}/decline`, {}),
  );

/** A rule become a policy: adopted at once, or on trial. */
export const decidePolicy = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { proposalId: proposalId(v.proposalId), how: v.how === 'adopt' ? 'adopt' : 'trial' };
  })
  .handler(({ data }) =>
    gesture<{ policyId: string; status: 'active' | 'trial' }>(
      `/v1/threads/proposals/${data.proposalId}/policy`,
      { how: data.how },
    ),
  );

/** « Inviter quelqu’un »: her thread « Kete » becomes a group. */
export const inviteToKete = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return {
      threadId: threadId(v.threadId),
      people: (Array.isArray(v.people) ? v.people : [])
        .map((p) => text(p, 100))
        .filter(Boolean)
        .slice(0, 20),
    };
  })
  .handler(({ data }) =>
    gesture<{ invited: number }>(`/v1/threads/${data.threadId}/invite`, { people: data.people }),
  );

// --- Her agents as colleagues (spec 099, FR-013 to FR-017) -------------------------------------------

const agentId = (value: unknown) => {
  const id = text(value, 100);
  if (!/^agt_[0-9A-Za-z_-]{3,90}$/.test(id)) throw new Error('Which agent?');
  return id;
};

/** Her agents by state, with their threads, and how many work and wait for her. */
export const fetchAgentsScreen = createServerFn({ method: 'GET' }).handler(() =>
  callApi<AgentsScreen>(getRequest(), '/v1/threads/agents'),
);

/** The thread of one of her agents: opened the first time. */
export const openAgentThread = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ agentId: agentId((input as { agentId?: unknown })?.agentId) }))
  .handler(({ data }) =>
    gesture<{ threadId: string }>(`/v1/threads/agents/${data.agentId}/thread`, {}),
  );

/** Its job description at work: what it takes on, covers, uses, returns, its routine. */
export const setAgentJob = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const levels = ['never', 'proposes', 'alone'];
    const takeOn = Object.fromEntries(
      Object.entries((v.takeOn ?? {}) as Record<string, unknown>).filter(
        ([k, l]) => ['described', 'other', 'mention'].includes(k) && levels.includes(String(l)),
      ),
    ) as Record<string, string>;
    const routine = v.routine as {
      time?: unknown;
      cadence?: unknown;
      instruction?: unknown;
    } | null;
    return {
      agentId: agentId(v.agentId),
      ...(Object.keys(takeOn).length ? { takeOn } : {}),
      ...(Array.isArray(v.covers)
        ? {
            covers: v.covers
              .map((w) => text(w, 40))
              .filter((w) => w.length >= 2)
              .slice(0, 20),
          }
        : {}),
      ...(v.computerMinutes === null
        ? { computerMinutes: null }
        : typeof v.computerMinutes === 'number'
          ? { computerMinutes: Math.max(1, Math.min(10000, Math.round(v.computerMinutes))) }
          : {}),
      ...(v.returnTo === 'giver' || v.returnTo === 'owner' ? { returnTo: v.returnTo } : {}),
      ...(routine === null
        ? { routine: null }
        : routine && typeof routine === 'object'
          ? {
              routine: {
                time: text(routine.time, 5),
                cadence: routine.cadence === 'daily' ? 'daily' : 'weekdays',
                instruction: text(routine.instruction, 2000),
              },
            }
          : {}),
    };
  })
  .handler(({ data }) => {
    const { agentId: id, ...body } = data;
    return gesture<{ agentId: string }>(`/v1/threads/agents/${id}/job`, body);
  });

/** « Essayer maintenant »: its routine sets it to work at once. */
export const routineNow = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ agentId: agentId((input as { agentId?: unknown })?.agentId) }))
  .handler(({ data }) =>
    gesture<{ taskId: string | null }>(`/v1/threads/agents/${data.agentId}/routine/now`, {}),
  );

/** Her answer to what an agent asks: once, always, or not. */
export const answerRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const id = text(v.draftId, 100);
    if (!/^[a-z]{3}_[0-9A-Za-z_-]{8,70}$/.test(id)) throw new Error('Which request?');
    const how: 'once' | 'always' | 'refuse' =
      v.how === 'always' ? 'always' : v.how === 'refuse' ? 'refuse' : 'once';
    return { draftId: id, how };
  })
  .handler(({ data }) =>
    gesture<{ status: string; proposalId?: string }>(
      `/v1/threads/requests/${data.draftId}/${data.how}`,
      {},
    ),
  );

/** « Confier à l’agent »: the holding goes to the agent that proposed to take it on. */
export const takeOnProposal = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    proposalId: proposalId((input as { proposalId?: unknown })?.proposalId),
  }))
  .handler(({ data }) =>
    gesture<{ handed: true }>(`/v1/threads/proposals/${data.proposalId}/takeon`, {}),
  );
