import type { TestSchema } from '@kete/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useNoteModel } from '../src/features/notes/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 055: « Noter » — a note kept in her notebook, understood, a reminder filed in « À faire »
// when it names a moment, undone in one gesture; hers alone.

let db: TestSchema;
const api = createApi();
const t = { awa: '', kofi: '', admin: '' };

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const reading = (value: object) =>
  new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(value) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    },
  });
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.toISOString().slice(0, 10)}T10:00`;
};
type Task = { source: string; title: string; dueAt: string | null };
const tasksOf = async (token: string) =>
  ((await call(token, 'GET', '/workspace/tasks')).body.tasks as Task[]).filter(
    (x) => x.source === 'notes',
  );

beforeAll(async () => {
  db = await startApi();
  process.env.PUBLIC_WEB_URL = 'https://enterprise.kete.test';
  t.awa = await tokenFor('usr_awa', { name: 'Awa' });
  t.kofi = await tokenFor('usr_kofi', { name: 'Kofi' });
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
});

afterAll(async () => {
  useNoteModel(undefined);
  await db?.drop();
});

describe('a note', () => {
  let noteId = '';

  it('is kept, understood, and files a reminder when it names a moment', async () => {
    useNoteModel(
      reading({
        summary: 'Réunion avec Kofi sur l’enquête T3.',
        reminder: { title: 'Réunion avec Kofi · enquête T3', at: tomorrow() },
      }),
    );
    const written = await call(t.awa, 'POST', '/notes', {
      text: 'Réunion demain à 10 h avec Kofi sur l’enquête T3',
    });
    expect(written.status).toBe(201);
    const note = written.body.note as { noteId: string; reminder: { title: string } | null };
    noteId = note.noteId;
    expect(note.reminder?.title).toBe('Réunion avec Kofi · enquête T3');
    expect(await tasksOf(t.awa)).toEqual([
      expect.objectContaining({
        title: 'Réunion avec Kofi · enquête T3',
        dueAt: expect.any(String),
      }),
    ]);
  });

  it('files nothing when it names no moment, or without a model', async () => {
    useNoteModel(reading({ summary: 'Idée pour le stock.', reminder: null }));
    await call(t.awa, 'POST', '/notes', { text: 'Idée : regrouper les commandes de batteries' });
    useNoteModel(null);
    const plain = await call(t.awa, 'POST', '/notes', { text: 'Penser au devis' });
    expect(plain.body.note).toMatchObject({ summary: null, reminder: null });
    expect((await tasksOf(t.awa)).length).toBe(1);
    expect(((await call(t.awa, 'GET', '/notes')).body.notes as unknown[]).length).toBe(3);
  });

  it('loses its reminder in one gesture, the note staying', async () => {
    expect((await call(t.awa, 'POST', `/notes/${noteId}/unfile`)).status).toBe(200);
    expect(await tasksOf(t.awa)).toEqual([]);
    const notes = (await call(t.awa, 'GET', '/notes')).body.notes as {
      noteId: string;
      reminder: unknown;
    }[];
    expect(notes.find((n) => n.noteId === noteId)?.reminder).toBeNull();
  });

  it('is hers alone', async () => {
    expect((await call(t.kofi, 'GET', '/notes')).body.notes).toEqual([]);
    // Not even an administrator viewing her space (a demo organization) reads it.
    const personId = (
      await call(t.admin, 'POST', '/structure/people', { name: 'Awa', accountUserId: 'usr_awa' })
    ).body.personId as string;
    await db.owner.query(
      `insert into ${db.schema}.organization_settings (organization_id, demo) values ('org_kya', true)
       on conflict (organization_id) do update set demo = true`,
    );
    const viewed = await api.request('/v1/notes', {
      headers: { authorization: `Bearer ${t.admin}`, 'kete-view-as': personId },
    });
    expect(viewed.status).toBe(200);
    expect(((await viewed.json()) as Answer).notes).toEqual([]);
    expect(
      (
        await api.request('/v1/notes', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${t.admin}`,
            'kete-view-as': personId,
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({ text: 'Écrit à sa place' }),
        })
      ).status,
    ).toBe(403);
    expect((await call(t.kofi, 'POST', `/notes/${noteId}/remove`)).status).toBe(404);
    expect((await call(t.awa, 'POST', `/notes/${noteId}/remove`)).status).toBe(200);
  });
});
