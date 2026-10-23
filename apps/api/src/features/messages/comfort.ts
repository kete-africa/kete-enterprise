import { fromEml } from '@kete/channels';
import type { Message } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import {
  announceTyping,
  deleteMessage,
  importMessages,
  mediaOf,
  mergeThreads,
  messagesPage,
  notifyLevelOf,
  parseTelegramExport,
  parseWhatsAppExport,
  pinMessage,
  postMessage,
  react,
  saveThreadFile,
  setNotifyLevel,
  setTranscript,
  shareMessage,
  unpinMessage,
  unreact,
  type ImportedMessage,
} from '@kete/threads';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { fileStorage } from '../../platform/storage.js';
import { transcribeAudio, TranscriptionUnavailable } from '../../platform/transcription.js';
import { usageStore } from '../../platform/usage.js';
import { CENTER, findObjects, kindsOf } from '../objects/index.js';
import { mayManage, me, readable, refuse } from './access.js';
import { startTurn } from './door.js';
import { namesOf } from './state.js';
import { messageWords } from './words.js';

// The threads at today's level (spec 099, FR-001 to FR-006, FR-019; kete-core spec 140): pages,
// what a thread holds, reactions, pins, a message taken back, Kete's private answer shared, her
// notification level, who is writing, voice notes transcribed, « # » to cite any object, and the
// conversations people had elsewhere imported, two threads merged.

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

const messageId = z.string().regex(/^msg_[0-9A-Za-z_-]{8,70}$/);
const threadId = z.string().regex(/^thr_[0-9A-Za-z_-]{8,70}$/);
/** 100 MB in base64. */
const MAX_BASE64 = Math.ceil((100 * 1024 * 1024 * 4) / 3) + 8;

/** The threads' files: in the instance's storage. */
export const threadStore = () => fileStorage() ?? undefined;

const storeOption = () => {
  const store = threadStore();
  return store ? { store } : {};
};

/** The thread a message is said in, read by her. */
async function threadOfMessage(db: SqlExecutor, identity: Identity, id: string) {
  const { rows } = await db.query<{ thread_id: string }>(
    `select thread_id from kete_messages where message_id = $1`,
    [id],
  );
  if (!rows[0]) throw new GestureRefusal(404, 'not_found', 'No such message.');
  return readable(db, identity, rows[0].thread_id);
}

/** The words of an object cited with « # », in its state of now, as she may read it. */
export async function citedStates(
  db: SqlExecutor,
  references: { kind: string; id: string; app?: string }[],
): Promise<Record<string, { label: string; state: string | null }>> {
  const states: Record<string, { label: string; state: string | null }> = {};
  if (references.length > 0) {
    // The index says each object's title and state now (spec 100): projects, parties, assets, the
    // apps' objects alike.
    const kinds = await kindsOf(db);
    const { rows } = await db.query<{
      kind: string;
      object_id: string;
      title: string;
      state: string | null;
    }>(
      `select kind, object_id, title, state from kete_objects
        where (kind, object_id) in (select * from unnest($1::text[], $2::text[]))`,
      [references.map((r) => r.kind), references.map((r) => r.id)],
    );
    for (const row of rows) {
      const kind = kinds.find((k) => k.kind === row.kind);
      states[`${row.kind}:${row.object_id}`] = {
        label: row.title,
        state: kind?.states.find((x) => x.id === row.state)?.label.fr ?? row.state,
      };
    }
  }
  for (const reference of references) {
    const key = `${reference.kind}:${reference.id}`;
    states[key] ??= { label: reference.id, state: reference.app ?? null };
  }
  return states;
}

/**
 * The objects « # » offers her: what she may read of the index — projects, third parties, assets,
 * places, the apps' objects (spec 100) — then the apps' objects whose threads she is in that their
 * app has not said to the index yet.
 */
async function objectsFor(db: SqlExecutor, identity: Identity, q: string) {
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const indexed = await findObjects(db, identity, { q, limit: 16 });
  const { rows: objects } = await db.query<{
    object_kind: string;
    object_id: string;
    product: string;
    title: string;
  }>(
    `select t.object_kind, t.object_id, o.product, t.title
       from thread_objects o join kete_threads t using (thread_id)
      where (t.title ilike $1 or t.object_id ilike $1)
        and not exists (select 1 from kete_objects x
                         where x.kind = t.object_kind and x.object_id = t.object_id)
        and exists (select 1 from kete_thread_members m
                     where m.thread_id = t.thread_id and m.member_kind = 'person'
                       and m.member_id = $2 and m.until is null)
      order by t.opened_at desc limit 8`,
    [like, identity.userId],
  );
  return [
    ...indexed.map((o) => ({
      kind: o.kind,
      id: o.id,
      ...(o.product !== CENTER ? { app: o.product } : {}),
      label: o.title,
      state: o.stateLabel,
    })),
    ...objects.map((o) => ({
      kind: o.object_kind,
      id: o.object_id,
      app: o.product,
      label: o.title,
      state: o.product,
    })),
  ];
}

/** Who wrote a line of an export: a person of the center, by her phone's last digits or her name. */
async function authorsOf(db: SqlExecutor, messages: ImportedMessage[]) {
  const { rows } = await db.query<{
    account_user_id: string | null;
    name: string;
    phone: string | null;
  }>(`select account_user_id, name, phone from people where account_user_id is not null`);
  const digits = (value: string) => value.replace(/\D/g, '').slice(-8);
  const known = new Map<string, { kind: 'person'; id: string }>();
  for (const said of new Set(messages.map((m) => m.author))) {
    const found = rows.find(
      (p) =>
        p.name.toLowerCase() === said.toLowerCase() ||
        (p.phone && digits(said).length === 8 && digits(p.phone) === digits(said)),
    );
    if (found?.account_user_id) known.set(said, { kind: 'person', id: found.account_user_id });
  }
  return known;
}

/** A voice note's words, once it is kept: written by the transcription model, after the answer. */
async function transcribeLater(
  identity: Identity,
  message: string,
  fileId: string,
  audio: Uint8Array,
  /** In her thread « Kete »: once heard, Kete takes its turn on it (FR-010, case A). */
  toKete?: string,
) {
  try {
    const said = await transcribeAudio(audio, {
      store: usageStore(),
      context: {
        organizationId: identity.organizationId,
        actor: { kind: 'person', id: identity.userId, channel: 'web' },
        purpose: 'threads',
        model: '',
      },
    });
    if (!said.text) return;
    await transaction(identity.organizationId, (db) =>
      setTranscript(db, identity.organizationId, { messageId: message, fileId, text: said.text }),
    );
    if (toKete) startTurn(identity, { threadId: toKete, question: said.text });
  } catch (error) {
    if (!(error instanceof TranscriptionUnavailable)) {
      console.error('[thread voice]', (error as Error).message);
    }
  }
}

export const comfortRoutes = new Hono<{ Variables: IdentityVariables }>()
  // « # »: the objects she may cite, in their state of now (FR-006).
  .get('/objects', async (c: Ctx) => {
    const identity = c.get('identity');
    const q = (c.req.query('q') ?? '').trim().slice(0, 80);
    const objects = await transaction(identity.organizationId, (db) => objectsFor(db, identity, q));
    return c.json({ objects });
  })
  // Fifty messages before one, or around one a search found (FR-001).
  .get('/:threadId/page', async (c: Ctx) => {
    const identity = c.get('identity');
    const before = c.req.query('before');
    const around = c.req.query('around');
    const page = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      const found = await messagesPage(db, thread.id, {
        viewer: me(identity),
        ...(before && messageId.safeParse(before).success ? { before } : {}),
        ...(around && messageId.safeParse(around).success ? { around } : {}),
      });
      const ids = found.messages.flatMap((m) => [m.author.id, ...m.readBy.map((r) => r.id)]);
      const references = found.messages.flatMap((m) => m.references ?? []);
      return {
        ...found,
        names: await namesOf(db, ids, identity, messageWords().outsider),
        cited: await citedStates(db, references),
      };
    }).catch(refuse);
    return c.json(page);
  })
  // What a thread holds, and her notification level: « Infos du fil » (FR-002).
  .get('/:threadId/media', async (c: Ctx) => {
    const identity = c.get('identity');
    const answer = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      return {
        media: await mediaOf(db, thread.id, { viewer: me(identity) }),
        level: await notifyLevelOf(db, thread.id, me(identity)),
      };
    });
    return c.json(answer);
  })
  // Her notification level for a thread (FR-005).
  .post('/:threadId/notify', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({ level: z.enum(['all', 'mentions', 'none']) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'All, mentions or none.');
    await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      await setNotifyLevel(db, identity.organizationId, {
        threadId: thread.id,
        member: me(identity),
        level: parsed.data.level,
      });
    });
    return c.json({ level: parsed.data.level });
  })
  // She is writing: told to the thread, never kept (FR-001).
  .post('/:threadId/typing', async (c: Ctx) => {
    const identity = c.get('identity');
    await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      await announceTyping(db, identity.organizationId, {
        threadId: thread.id,
        member: me(identity),
      });
    });
    return c.json({ ok: true });
  })
  // A voice note: kept in the storage, said in the thread, transcribed after (FR-003).
  .post('/:threadId/voice', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({
        data: z.string().min(1).max(MAX_BASE64),
        contentType: z
          .string()
          .regex(/^audio\/[a-z0-9.+-]+(;.*)?$/)
          .max(100),
        durationMs: z
          .number()
          .int()
          .min(0)
          .max(30 * 60 * 1000),
        visibility: z.enum(['internal', 'outside']).default('internal'),
        replyTo: messageId.optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A voice note.');
    const audio = new Uint8Array(Buffer.from(parsed.data.data, 'base64'));
    const type = parsed.data.contentType.split(';')[0] ?? 'audio/webm';
    const posted = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      const file = await saveThreadFile(
        db,
        identity.organizationId,
        {
          threadId: thread.id,
          name: `vocal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${type.split('/')[1]?.split('+')[0] ?? 'webm'}`,
          mediaType: type,
          content: audio,
          by: me(identity),
        },
        new Date(),
        storeOption(),
      );
      const said = await postMessage(db, identity.organizationId, {
        thread: thread.id,
        author: me(identity),
        text: '',
        for: 'information',
        via: 'kete',
        visibility: 'internal',
        ...(parsed.data.replyTo ? { reply_to: parsed.data.replyTo } : {}),
        attachments: [
          {
            id: file.id,
            name: file.name,
            media_type: type,
            bytes: file.bytes,
            duration_ms: parsed.data.durationMs,
          },
        ] as NonNullable<Message['attachments']>,
      });
      const toKete = thread.kind === 'kete' && thread.holder.id === identity.userId;
      return { message: said.message, file: file.id, ...(toKete ? { kete: thread.id } : {}) };
    }).catch(refuse);
    void transcribeLater(identity, posted.message.id, posted.file, audio, posted.kete);
    return c.json(posted, 201);
  })
  // A reaction given or taken back (FR-001).
  .post('/messages/:messageId/react', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({ emoji: z.string().min(1).max(16), on: z.boolean().default(true) })
      .safeParse(await bodyOf(c));
    const id = messageId.safeParse(c.req.param('messageId'));
    if (!parsed.success || !id.success)
      throw new GestureRefusal(422, 'invalid_input', 'One emoji.');
    await transaction(identity.organizationId, async (db) => {
      await threadOfMessage(db, identity, id.data);
      if (parsed.data.on) {
        await react(db, identity.organizationId, {
          messageId: id.data,
          by: me(identity),
          emoji: parsed.data.emoji,
        });
      } else {
        await unreact(db, { messageId: id.data, by: me(identity), emoji: parsed.data.emoji });
      }
    }).catch(refuse);
    return c.json({ ok: true });
  })
  // A message pinned or unpinned, for every member (FR-001).
  .post('/messages/:messageId/pin', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z.object({ pinned: z.boolean() }).safeParse(await bodyOf(c));
    const id = messageId.safeParse(c.req.param('messageId'));
    if (!parsed.success || !id.success)
      throw new GestureRefusal(422, 'invalid_input', 'Pinned or not.');
    await transaction(identity.organizationId, async (db) => {
      await threadOfMessage(db, identity, id.data);
      if (parsed.data.pinned) {
        await pinMessage(db, identity.organizationId, { messageId: id.data, by: me(identity) });
      } else {
        await unpinMessage(db, { messageId: id.data, by: me(identity) });
      }
    }).catch(refuse);
    return c.json({ ok: true });
  })
  // Its author takes a message back: « Message supprimé »; the proof keeps it (FR-001).
  .post('/messages/:messageId/delete', async (c: Ctx) => {
    const identity = c.get('identity');
    const id = messageId.safeParse(c.req.param('messageId'));
    if (!id.success) throw new GestureRefusal(404, 'not_found', 'No such message.');
    await transaction(identity.organizationId, async (db) => {
      await threadOfMessage(db, identity, id.data);
      await deleteMessage(db, identity.organizationId, { messageId: id.data, by: me(identity) });
    }).catch(refuse);
    return c.json({ ok: true });
  })
  // Kete's answer only for her, shared with the thread (FR-009).
  .post('/messages/:messageId/share', async (c: Ctx) => {
    const identity = c.get('identity');
    const id = messageId.safeParse(c.req.param('messageId'));
    if (!id.success) throw new GestureRefusal(404, 'not_found', 'No such message.');
    const message = await transaction(identity.organizationId, async (db) => {
      await threadOfMessage(db, identity, id.data);
      return shareMessage(db, identity.organizationId, { messageId: id.data, by: me(identity) });
    }).catch(refuse);
    return c.json({ message });
  })
  // A WhatsApp or Telegram export, or a mail file, kept in the thread, once (FR-019).
  .post('/:threadId/import', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({
        kind: z.enum(['whatsapp', 'telegram', 'eml']),
        data: z.string().min(1).max(MAX_BASE64),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'An export.');
    const text = Buffer.from(parsed.data.data, 'base64').toString('utf8');
    let messages: ImportedMessage[];
    try {
      if (parsed.data.kind === 'whatsapp') messages = parseWhatsAppExport(text);
      else if (parsed.data.kind === 'telegram') messages = parseTelegramExport(text);
      else {
        const mail = await fromEml(text);
        messages = [
          {
            at: new Date(mail.at),
            author: mail.from.name ?? mail.from.address ?? mail.from.key,
            text: mail.subject ? `${mail.subject}\n\n${mail.text}` : mail.text,
            attachments: mail.attachments.map((a) => a.name),
          },
        ];
      }
    } catch {
      throw new GestureRefusal(422, 'unreadable_export', 'This export cannot be read.');
    }
    if (messages.length === 0) throw new GestureRefusal(422, 'empty_export', 'Nothing to import.');
    const answer = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      const known = await authorsOf(db, messages);
      const done = await importMessages(db, identity.organizationId, {
        threadId: thread.id,
        via: parsed.data.kind === 'eml' ? 'mail' : parsed.data.kind,
        messages,
        authorOf: (name) => known.get(name) ?? null,
      });
      const unknown = [...new Set(messages.map((m) => m.author))].filter(
        (name) => !known.has(name),
      );
      return { ...done, recognized: known.size, unknown };
    }).catch(refuse);
    return c.json(answer, 201);
  })
  // Two threads that speak of the same thing become one, by the holder of the first (FR-019).
  .post('/:threadId/merge', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z.object({ into: threadId }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Into which thread?');
    const merged = await transaction(identity.organizationId, async (db) => {
      const from = await readable(db, identity, c.req.param('threadId') ?? '');
      mayManage(identity, from);
      await readable(db, identity, parsed.data.into);
      return mergeThreads(db, identity.organizationId, {
        from: from.id,
        into: parsed.data.into,
        by: from.holder,
      });
    }).catch(refuse);
    return c.json(merged);
  });
