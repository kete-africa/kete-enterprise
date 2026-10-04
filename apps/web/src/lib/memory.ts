import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// What her assistant remembers about her (spec 029), as the API serves it.

export interface Memory {
  memoryId: string;
  text: string;
  origin: 'person' | 'assistant';
  createdAt: string;
}

export const fetchMemories = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ memories: Memory[] }>(getRequest(), '/v1/assistant/memories'),
);

export const addMemory = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const t = (input as { text?: unknown } | null)?.text;
    return { text: typeof t === 'string' ? t.slice(0, 300) : '' };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      '/v1/assistant/memories',
      data,
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

export const forgetMemory = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const id = (input as { memoryId?: unknown } | null)?.memoryId;
    if (typeof id !== 'string' || !/^mem_[0-9A-Za-z_-]{4,70}$/.test(id))
      throw new Error('Which one?');
    return { memoryId: id };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/assistant/memories/${data.memoryId}/forget`,
      {},
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
