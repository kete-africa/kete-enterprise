import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Exchanges between assistants (spec 057), as the API serves them.

export const subjects = ['availability', 'workload'] as const;
export type Subject = (typeof subjects)[number];

export interface Exchange {
  exchangeId: string;
  from: { userId: string; name: string };
  to: { userId: string; name: string };
  subject: Subject | 'other';
  question: string;
  status: 'answered' | 'waiting' | 'replied' | 'declined' | 'withdrawn';
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface ExchangesScreen {
  allowed: Subject[];
  received: Exchange[];
  sent: Exchange[];
}

export const fetchExchanges = createServerFn({ method: 'GET' }).handler(() =>
  callApi<ExchangesScreen>(getRequest(), '/v1/exchanges'),
);

const done = (answer: { ok: boolean; error?: string | null }) =>
  answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error ?? null };

/** What her assistant may answer alone: nothing until she says so. */
export const allowSubjects = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const allowed = (input as { allowed?: unknown } | null)?.allowed;
    return {
      allowed: subjects.filter((subject) => Array.isArray(allowed) && allowed.includes(subject)),
    };
  })
  .handler(async ({ data }) =>
    done(await sendGesture(getRequest(), '/v1/exchanges/settings', data, crypto.randomUUID())),
  );

const exchangeIdOf = (input: unknown) => {
  const id = (input as { exchangeId?: unknown } | null)?.exchangeId;
  if (typeof id !== 'string' || !/^exc_[0-9A-Za-z_-]{4,64}$/.test(id)) {
    throw new Error('Which exchange?');
  }
  return id;
};

export const replyExchange = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const answer = (input as { answer?: unknown } | null)?.answer;
    return {
      exchangeId: exchangeIdOf(input),
      answer: typeof answer === 'string' ? answer.trim().slice(0, 2000) : '',
    };
  })
  .handler(async ({ data }) =>
    done(
      await sendGesture(
        getRequest(),
        `/v1/exchanges/${data.exchangeId}/reply`,
        { answer: data.answer },
        crypto.randomUUID(),
      ),
    ),
  );

export const declineExchange = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ exchangeId: exchangeIdOf(input) }))
  .handler(async ({ data }) =>
    done(
      await sendGesture(
        getRequest(),
        `/v1/exchanges/${data.exchangeId}/decline`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );

/** The asker takes back a question that still waits. */
export const withdrawExchange = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ exchangeId: exchangeIdOf(input) }))
  .handler(async ({ data }) =>
    done(
      await sendGesture(
        getRequest(),
        `/v1/exchanges/${data.exchangeId}/withdraw`,
        {},
        crypto.randomUUID(),
      ),
    ),
  );
