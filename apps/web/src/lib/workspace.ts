import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// The person's day, her briefing and her assistant, as the API serves them (spec 014).

export interface Facts {
  name: string;
  today: string;
  forms: { title: string; period: string; closesOn: string; done: number; total: number }[];
  decisions: { title: string; overdue: boolean }[];
  actions: { title: string; dueOn: string; overdue: boolean; source: string }[];
  notes: { number: string | null; subject: string }[];
  performance: {
    position: string;
    status: string;
    factor: number | null;
    reds: string[];
    oranges: string[];
  }[];
  team: { name: string; status: string; reds: number; factor: number | null }[];
  meetings: { title: string; when: string; decisions: string[] }[];
  apps: { name: string; address: string | null; kind: string }[];
  tasks: { title: string; source: string; dueAt: string | null; overdue: boolean }[];
}

export interface Briefing {
  text: string;
  generatedBy: 'model' | 'rules';
  at: string;
  facts: Facts;
}

export const fetchBriefing = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Briefing>(getRequest(), '/v1/assistant/briefing'),
);

export const refreshBriefing = createServerFn({ method: 'POST' }).handler(async () => {
  const answer = await sendGesture<Briefing>(
    getRequest(),
    '/v1/assistant/briefing',
    {},
    crypto.randomUUID(),
  );
  return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
});

export const fetchAssistant = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ available: boolean; provider: string | null; model: string | null }>(
    getRequest(),
    '/v1/assistant',
  ),
);

export const fetchUsage = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{
    provider: string | null;
    model: string | null;
    monthlyTokens: number | null;
    purposes: { purpose: string; calls: number; tokens: number }[];
  }>(getRequest(), '/v1/assistant/usage'),
);

export const setBudget = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const monthlyTokens = (input as { monthlyTokens?: unknown } | null)?.monthlyTokens;
    if (typeof monthlyTokens !== 'number' || monthlyTokens < 0) throw new Error('A budget.');
    return { monthlyTokens };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      '/v1/assistant/budget',
      data,
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

/** A draft prepared by an agent, as the person reviews it (spec 017). */
export interface DraftReview {
  draftId: string;
  capability: string;
  description: string;
  autonomy: 3 | 4;
  recordType: string;
  status: 'prepared' | 'validated' | 'refused';
  values: Record<string, string | number | boolean | null>;
  provenance: Record<string, { source: string; certainty?: string }>;
  /** Its identifiers in words: a person's name, a review's holder, a reading's value. */
  display?: Record<string, string>;
}

export interface StoredMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  tools: { name: string; state: 'done' | 'refused' }[];
  drafts: DraftReview[];
  createdAt: string;
}

export const fetchConversations = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ conversations: { conversationId: string; title: string; updatedAt: string }[] }>(
    getRequest(),
    '/v1/assistant/conversations',
  ),
);

export const fetchConversation = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const id = (input as { conversationId?: unknown } | null)?.conversationId;
    if (typeof id !== 'string' || !/^cnv_[0-9a-f-]{8,64}$/.test(id)) throw new Error('Unknown.');
    return { conversationId: id };
  })
  .handler(({ data }) =>
    callApi<{ conversationId: string; title: string; messages: StoredMessage[] }>(
      getRequest(),
      `/v1/assistant/conversations/${data.conversationId}`,
    ).catch(() => null),
  );

export const fetchDrafts = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ drafts: DraftReview[] }>(getRequest(), '/v1/assistant/drafts'),
);

/** The person validates or refuses a draft: the same command as her screen runs. */
export const decideDraft = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { draftId, action } = (input ?? {}) as { draftId?: unknown; action?: unknown };
    if (typeof draftId !== 'string' || !/^drf_[0-9a-zA-Z_-]{8,64}$/.test(draftId)) {
      throw new Error('Unknown draft.');
    }
    if (action !== 'validate' && action !== 'refuse') throw new Error('A decision.');
    return { draftId, action };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/assistant/drafts/${data.draftId}/decide`,
      { action: data.action },
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

/** What the team's apps put in the person's To do (spec 018). */
export interface AppTask {
  taskId: string;
  source: string;
  title: string;
  href: string;
  dueAt: string | null;
  overdue: boolean;
}

export const fetchTasks = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ tasks: AppTask[] }>(getRequest(), '/v1/workspace/tasks'),
);
