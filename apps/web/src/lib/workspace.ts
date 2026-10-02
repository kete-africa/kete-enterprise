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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One turn of the conversation: the assistant answers with the person's own tools. */
export const chat = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const messages = (input as { messages?: unknown } | null)?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
      throw new Error('A conversation is required.');
    }
    return {
      messages: messages.map((m) => {
        const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown };
        if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
          throw new Error('Unknown message.');
        }
        return { role, content: content.slice(0, 4000) } as ChatMessage;
      }),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ text: string; tools: string[] }>(
      getRequest(),
      '/v1/assistant/chat',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true, error: null, text: answer.data.text, tools: answer.data.tools }
      : { ok: false, error: answer.error, text: '', tools: [] as string[] };
  });

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
