import { answerByMail, settle } from '@kete/channels';
import { pdfConverterFromEnv, type PdfConverter } from '@kete/files';
import type { SqlExecutor } from '@kete/tenancy';
import {
  editMessage,
  exportThread,
  getThread,
  markRead,
  messagesOf,
  openThread,
  postMessage,
  searchMessages,
  ThreadError,
  threadOf,
  threadsOf,
} from '@kete/threads';
import { getHolding } from '@kete/work';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import { centerRouter, keteThreadOf } from './center.js';
import {
  listMailboxes,
  mailboxInput,
  MailboxError,
  mailboxOf,
  saveMailbox,
  senderOf,
} from './mailboxes.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

let converterOverride: PdfConverter | null | undefined;
/** Tests: another conversion service (`null`: none). */
export function useThreadConverter(next: PdfConverter | null | undefined): void {
  converterOverride = next;
}

function refuse(error: unknown): never {
  if (error instanceof ThreadError) {
    const status = {
      not_found: 404,
      closed: 409,
      already_edited: 409,
      not_the_author: 403,
      invalid_thread: 422,
      invalid_message: 422,
    } as const;
    throw new GestureRefusal(status[error.code], error.code, error.message);
  }
  throw error;
}

const me = (identity: Identity) => ({ kind: 'person' as const, id: identity.userId });

/** A thread is read by its members now, and by the administrators. */
async function readable(db: SqlExecutor, identity: Identity, threadId: string) {
  const thread = await getThread(db, threadId);
  if (!thread) throw new GestureRefusal(404, 'not_found', 'No such thread here.');
  const member = (thread.members ?? []).some(
    (m) => m.kind === 'person' && m.id === identity.userId && !m.until,
  );
  if (!member && !isAdministrator(identity)) {
    throw new GestureRefusal(403, 'not_a_member', 'Only its members read a thread.');
  }
  return thread;
}

const ref = z.object({ kind: z.string().min(1).max(60), id: z.string().min(1).max(200) });
const person = z.object({ kind: z.enum(['person', 'agent']), id: z.string().min(1).max(100) });

const openInput = z.object({
  kind: z.enum(['group', 'direct']),
  title: z.string().trim().min(1).max(200),
  members: z.array(person).max(200).default([]),
});

const postInput = z.object({
  text: z.string().trim().min(1).max(20000),
  for: z.enum(['action', 'information']).default('information'),
  to: person.optional(),
  replyTo: z.string().optional(),
  /** Whether it leaves by mail to the thread's contacts who write by mail (default: yes). */
  byMail: z.boolean().default(true),
});

/** Threads, under /v1/threads (spec 089). */
export const threadRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    const identity = c.get('identity');
    const threads = await transaction(identity.organizationId, (db) => threadsOf(db, me(identity)));
    return c.json({ threads });
  })
  .post('/', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = openInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A kind and a title.');
    const thread = await transaction(identity.organizationId, (db) =>
      openThread(db, identity.organizationId, { ...parsed.data, holder: me(identity) }),
    ).catch(refuse);
    return c.json({ thread }, 201);
  })
  // Her thread with Kete.
  .get('/kete', async (c: Ctx) => {
    const identity = c.get('identity');
    const thread = await transaction(identity.organizationId, (db) =>
      keteThreadOf(db, identity.organizationId, identity.userId),
    );
    return c.json({ thread });
  })
  .get('/search', async (c: Ctx) => {
    const identity = c.get('identity');
    const text = (c.req.query('q') ?? '').trim();
    if (text.length < 2) throw new GestureRefusal(422, 'invalid_input', 'Two letters at least.');
    const found = await transaction(identity.organizationId, async (db) => {
      const mine = new Set((await threadsOf(db, me(identity))).map((t) => t.id));
      const hits = await searchMessages(db, { text, limit: 50 });
      return isAdministrator(identity) ? hits : hits.filter((m) => mine.has(m.thread));
    });
    return c.json({ messages: found });
  })
  // An object's thread, if it has one.
  .get('/of/:kind/:id', async (c: Ctx) => {
    const identity = c.get('identity');
    const object = ref.parse({ kind: c.req.param('kind'), id: c.req.param('id') });
    const thread = await transaction(identity.organizationId, async (db) => {
      const found = await threadOf(db, object);
      return found ? readable(db, identity, found.id) : null;
    });
    if (!thread) throw new GestureRefusal(404, 'not_found', 'This object has no thread yet.');
    return c.json({ thread });
  })
  // A card « à classer » settled: by the person who holds it, or an administrator.
  .post('/triage/settle', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({
        via: z.enum(['whatsapp', 'telegram', 'mail', 'form']),
        ref: z.string().min(1).max(300),
        object: ref,
        intent: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
        learn: z.boolean().default(true),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What, and where.');
    const routing = await transaction(identity.organizationId, async (db) => {
      const { rows } = await db.query<{ asked: string | null }>(
        `select asked from kete_routings where via = $1 and ref = $2 order by at desc limit 1`,
        [parsed.data.via, parsed.data.ref],
      );
      const card = rows[0]?.asked ? await getHolding(db, rows[0].asked) : null;
      if (!rows[0]) throw new GestureRefusal(404, 'not_found', 'Nothing received under it.');
      if (card && card.holder.id !== identity.userId && !isAdministrator(identity)) {
        throw new GestureRefusal(403, 'not_yours', 'This card is someone else’s.');
      }
      return settle(
        db,
        identity.organizationId,
        { ...parsed.data, by: me(identity) },
        await centerRouter(db, identity.organizationId),
      );
    });
    return c.json({ routing });
  })
  // The mailboxes the center reads: administrators connect them; a password never comes back.
  .get('/mailboxes', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) throw new GestureRefusal(403, 'forbidden', 'Administrators.');
    return c.json({
      mailboxes: await transaction(identity.organizationId, (db) => listMailboxes(db)),
    });
  })
  .post('/mailboxes', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) throw new GestureRefusal(403, 'forbidden', 'Administrators.');
    const parsed = mailboxInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'The mailbox is incomplete.');
    try {
      await transaction(identity.organizationId, (db) =>
        saveMailbox(db, identity.organizationId, parsed.data, identity.userId),
      );
    } catch (error) {
      if (error instanceof MailboxError) throw new GestureRefusal(409, error.code, error.message);
      throw error;
    }
    return c.json({ connected: parsed.data.address }, 201);
  })
  // A thread and its messages: she has read them as she opens it.
  .get('/:threadId', async (c: Ctx) => {
    const identity = c.get('identity');
    const threadId = c.req.param('threadId') ?? '';
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const thread = await readable(db, identity, threadId);
        await markRead(db, identity.organizationId, { threadId, reader: me(identity) });
        return { thread, messages: await messagesOf(db, threadId) };
      }),
    );
  })
  .post('/:threadId/messages', async (c: Ctx) => {
    const identity = c.get('identity');
    const threadId = c.req.param('threadId') ?? '';
    const parsed = postInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Some words.');
    const answer = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, threadId);
      const posted = await postMessage(db, identity.organizationId, {
        thread: threadId,
        author: me(identity),
        text: parsed.data.text,
        for: parsed.data.for,
        ...(parsed.data.to ? { to: parsed.data.to } : {}),
        ...(parsed.data.replyTo ? { reply_to: parsed.data.replyTo } : {}),
        via: 'kete',
      }).catch(refuse);
      // Its contacts who write by mail read it by mail, from her own box.
      const byMail = (thread.members ?? []).some(
        (m) => m.kind === 'contact' && !m.until && m.id.startsWith('mail:'),
      );
      const account = parsed.data.byMail && byMail ? await mailboxOf(db, identity.userId) : null;
      const mailed = account
        ? await answerByMail(db, {
            message: posted.message,
            from: { address: account.address, ...(account.name ? { name: account.name } : {}) },
            ...senderOf(account),
          })
        : null;
      return { ...posted, mailed: mailed ? mailed.to : [] };
    });
    return c.json(answer, 201);
  })
  .post('/messages/:messageId/edit', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({ text: z.string().trim().min(1).max(20000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Some words.');
    const message = await transaction(identity.organizationId, (db) =>
      editMessage(db, identity.organizationId, {
        messageId: c.req.param('messageId') ?? '',
        by: me(identity),
        text: parsed.data.text,
      }),
    ).catch(refuse);
    return c.json({ message });
  })
  // The proof: its journal and fingerprint; a PDF when the conversion service is set.
  .get('/:threadId/export', async (c: Ctx) => {
    const identity = c.get('identity');
    const threadId = c.req.param('threadId') ?? '';
    const proof = await transaction(identity.organizationId, async (db) => {
      await readable(db, identity, threadId);
      return exportThread(db, threadId, { locale: c.req.query('locale') === 'en' ? 'en' : 'fr' });
    });
    const converter = converterOverride === undefined ? pdfConverterFromEnv() : converterOverride;
    if (c.req.query('format') === 'pdf' && converter) {
      const pdf = await converter.fromHtml(proof.html);
      return c.body(new Uint8Array(pdf), 200, {
        'content-type': 'application/pdf',
        'x-kete-fingerprint': proof.fingerprint,
      });
    }
    return c.json({ fingerprint: proof.fingerprint, journal: proof.journal });
  });
