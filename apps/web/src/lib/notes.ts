import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Her notebook (spec 055), as the API serves it.

export interface Note {
  noteId: string;
  text: string;
  summary: string | null;
  reminder: { title: string; at: string } | null;
  /** The subject of her day it reports on (spec 059). */
  about: { key: string; title: string } | null;
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
    const v = (input ?? {}) as { text?: unknown; about?: { key?: unknown; title?: unknown } };
    const text = typeof v.text === 'string' ? v.text.trim().slice(0, 4000) : '';
    const about =
      typeof v.about?.key === 'string' && typeof v.about.title === 'string'
        ? { key: v.about.key.slice(0, 200), title: v.about.title.trim().slice(0, 300) }
        : null;
    return about?.title ? { text, about } : { text };
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

/** « Dicter » (spec 059): a recording (base64) read by the API, which never keeps it. */
export const dictateNote = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { audio?: unknown; contentType?: unknown };
    const audio = typeof v.audio === 'string' ? v.audio.slice(0, 14_000_000) : '';
    const contentType =
      typeof v.contentType === 'string' && /^audio\/[\w.+-]+(;.*)?$/.test(v.contentType)
        ? v.contentType.slice(0, 120)
        : 'audio/webm';
    return { audio, contentType };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ text: string }>(
      getRequest(),
      '/v1/notes/dictate',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, text: answer.data.text, error: null }
      : { ok: false as const, text: '', error: answer.error };
  });
