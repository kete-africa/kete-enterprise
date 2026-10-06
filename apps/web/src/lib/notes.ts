import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Her notebook (spec 055), as the API serves it.

export interface Note {
  noteId: string;
  text: string;
  summary: string | null;
  reminder: { title: string; at: string } | null;
  createdAt: string;
}

const noteIdOf = (input: unknown) => {
  const id = (input as { noteId?: unknown } | null)?.noteId;
  if (typeof id !== 'string' || !/^nte_[0-9A-Za-z_-]{4,64}$/.test(id))
    throw new Error('Which note?');
  return id;
};

export const fetchNotes = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ notes: Note[] }>(getRequest(), '/v1/notes'),
);

/** « Noter »: kept at once, understood, a reminder filed when it names a moment. */
export const writeNote = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const text = (input as { text?: unknown } | null)?.text;
    return { text: typeof text === 'string' ? text.trim().slice(0, 4000) : '' };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ note: Note }>(
      getRequest(),
      '/v1/notes',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, note: answer.data.note, error: null }
      : { ok: false as const, note: null, error: answer.error };
  });

/** Its reminder leaves « À faire »; the note stays. */
export const unfileNote = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ noteId: noteIdOf(input) }))
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/notes/${data.noteId}/unfile`,
      {},
      crypto.randomUUID(),
    );
    return { ok: answer.ok, error: answer.ok ? null : answer.error };
  });

export const removeNote = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ noteId: noteIdOf(input) }))
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/notes/${data.noteId}/remove`,
      {},
      crypto.randomUUID(),
    );
    return { ok: answer.ok, error: answer.ok ? null : answer.error };
  });
