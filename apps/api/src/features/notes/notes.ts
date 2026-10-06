import { extract } from '@kete/ai';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { LanguageModel } from 'ai';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { organizationLanguageModel } from '../../platform/models.js';
import { usageStore } from '../../platform/usage.js';
import { closeTask, putTask } from '../workspace/index.js';

// « Noter » and « Mon carnet » (spec 055): a person writes down what she knows — « réunion demain
// à 10 h avec Kofi sur l'enquête T3 » — as she would on paper. Kete keeps it in her notebook,
// understands it, files a reminder in her « À faire » when it names a moment, and her assistant
// reads her latest notes to know what she is busy with. Hers alone; undone in one gesture.

type Identity = IdentityVariables['identity'];

export function notesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.person_notes (
  note_id text primary key,
  organization_id text not null,
  user_id text not null,
  text text not null check (length(text) between 1 and 4000),
  summary text check (length(summary) <= 300),
  reminder_title text check (length(reminder_title) <= 300),
  reminder_at timestamptz,
  created_at timestamptz not null default now()
);
create index person_notes_of on ${s}.person_notes (organization_id, user_id, created_at desc);
${organizationPolicySql({ schema: s, table: 'person_notes', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.person_notes to ${options.appRole};
`;
}

export interface Note {
  noteId: string;
  text: string;
  summary: string | null;
  reminder: { title: string; at: string } | null;
  createdAt: string;
}
type Row = {
  note_id: string;
  text: string;
  summary: string | null;
  reminder_title: string | null;
  reminder_at: Date | null;
  created_at: Date;
};
const noteOf = (r: Row): Note => ({
  noteId: r.note_id,
  text: r.text,
  summary: r.summary,
  reminder:
    r.reminder_title && r.reminder_at
      ? { title: r.reminder_title, at: r.reminder_at.toISOString() }
      : null,
  createdAt: r.created_at.toISOString(),
});

export async function listNotes(db: SqlExecutor, userId: string, limit = 100): Promise<Note[]> {
  const { rows } = await db.query<Row>(
    'select * from person_notes where user_id = $1 order by created_at desc limit $2',
    [userId, limit],
  );
  return rows.map(noteOf);
}

/** Her latest notes, for her assistant: what she is busy with, in her own words. */
export async function notesPromptFor(db: SqlExecutor, userId: string): Promise<string> {
  const notes = await listNotes(db, userId, 10);
  if (notes.length === 0) return '';
  return [
    '',
    'Ses dernières notes, écrites par elle (sers-t’en pour comprendre ce qui l’occupe ; ne les répète pas) :',
    ...notes.map(
      (n) => `- ${n.createdAt.slice(0, 10)} : ${n.text.replace(/\s+/g, ' ').slice(0, 300)}`,
    ),
  ].join('\n');
}

const understood = z.object({
  summary: z.string().min(1).max(300),
  reminder: z
    .object({
      title: z.string().min(1).max(300),
      at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    })
    .nullable(),
});

let modelOverride: LanguageModel | null | undefined;
/** Tests: understand notes with another model (`null`: as if none were configured). */
export function useNoteModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

/** Lomé's time is UTC all year: a local « 10:00 » is « 10:00Z ». Other zones are not guessed. */
const LOCAL_OFFSET = 'Z';

/** What a note says, as the model reads it; none without a model or when it fails. */
async function understand(
  identity: Identity,
  text: string,
  now: Date,
): Promise<z.infer<typeof understood> | null> {
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) return null;
  try {
    const { value } = await extract({
      model,
      schema: understood,
      system:
        'Tu lis une note qu’une personne vient d’écrire pour elle-même, en français. Résume-la en ' +
        'une phrase. Si elle nomme un moment précis à venir (une réunion, un appel, une échéance), ' +
        'propose un rappel : un titre court et la date et l’heure locales (AAAA-MM-JJTHH:MM, ' +
        'Lomé). Sinon, reminder vaut null. N’invente aucune date.',
      prompt: `Nous sommes le ${now.toISOString().slice(0, 16).replace('T', ' à ')} (heure de Lomé).\n\nNote : « ${text} »`,
      metering: {
        store: usageStore(),
        context: {
          organizationId: identity.organizationId,
          actor: {
            kind: 'agent',
            id: 'agt_assistant',
            channel: 'web',
            onBehalfOf: { kind: 'person', id: identity.userId },
          },
          purpose: 'note-understanding',
          model: '',
        },
      },
    });
    return value;
  } catch (error) {
    console.error('[notes] understanding failed', (error as Error).message);
    return null;
  }
}

const reminderKey = (noteId: string) => noteId;

/** Her notebook, under /v1/notes: hers alone, never while her space is viewed by another. */
export const noteRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    // Nobody else reads it — not even an administrator viewing her space.
    if (c.get('viewedBy')) return c.json({ notes: [] });
    const identity = c.get('identity');
    const notes = await transaction(identity.organizationId, (db) =>
      listNotes(db, identity.userId),
    );
    return c.json({ notes });
  })
  // « Noter »: kept at once, understood, a reminder filed in « À faire » when it names a moment.
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to write.');
    const parsed = z
      .object({ text: z.string().trim().min(1).max(4000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A note.');
    const identity = c.get('identity');
    const now = new Date();
    const reading = await understand(identity, parsed.data.text, now);
    const at = reading?.reminder ? new Date(`${reading.reminder.at}:00${LOCAL_OFFSET}`) : null;
    const reminder =
      reading?.reminder && at && !Number.isNaN(at.getTime()) && at > now
        ? { title: reading.reminder.title, at }
        : null;
    const note = await transaction(identity.organizationId, async (db) => {
      const noteId = newId('nte');
      const { rows } = await db.query<Row>(
        `insert into person_notes (note_id, organization_id, user_id, text, summary,
           reminder_title, reminder_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [
          noteId,
          identity.organizationId,
          identity.userId,
          parsed.data.text,
          reading?.summary ?? null,
          reminder?.title ?? null,
          reminder?.at ?? null,
        ],
      );
      // The reminder waits in « À faire » — an address of the space, so it needs its public URL.
      if (reminder && env.publicWebUrl) {
        await putTask(db, identity.organizationId, identity.userId, {
          source: 'notes',
          key: reminderKey(noteId),
          title: reminder.title,
          href: `${env.publicWebUrl}/carnet`,
          dueAt: reminder.at.toISOString(),
        });
      }
      return noteOf(rows[0] as Row);
    });
    return c.json({ note }, 201);
  })
  // « Annuler le rappel »: the note stays, its reminder leaves « À faire ».
  .post('/:noteId/unfile', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to change.');
    const identity = c.get('identity');
    const noteId = c.req.param('noteId');
    const done = await transaction(identity.organizationId, async (db) => {
      const { rows } = await db.query(
        `update person_notes set reminder_title = null, reminder_at = null
          where note_id = $1 and user_id = $2 returning note_id`,
        [noteId, identity.userId],
      );
      if (rows.length === 0) return false;
      await closeTask(db, identity.userId, { source: 'notes', key: reminderKey(noteId) });
      return true;
    });
    if (!done) throw new GestureRefusal(404, 'not_found', 'No such note.');
    return c.json({ unfiled: true });
  })
  .post('/:noteId/remove', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to remove.');
    const identity = c.get('identity');
    const noteId = c.req.param('noteId');
    const removed = await transaction(identity.organizationId, async (db) => {
      const { rows } = await db.query(
        'delete from person_notes where note_id = $1 and user_id = $2 returning note_id',
        [noteId, identity.userId],
      );
      if (rows.length === 0) return false;
      await closeTask(db, identity.userId, { source: 'notes', key: reminderKey(noteId) });
      return true;
    });
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such note.');
    return c.json({ removed: true });
  });
