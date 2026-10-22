import { settle } from '@kete/channels';
import { pdfConverterFromEnv, type PdfConverter } from '@kete/files';
import type { Message } from '@kete/sdk';
import {
  editMessage,
  exportThread,
  getThread,
  joinThread,
  leaveThread,
  markRead,
  markUnread,
  MAX_THREAD_FILE_BYTES,
  messagesPage,
  notifyLevelOf,
  moveMessage,
  openThread,
  postMessage,
  saveThreadFile,
  searchMessages,
  threadFile,
  threadFileInfo,
  threadOf,
  threadSummariesOf,
} from '@kete/threads';
import { finishHolding, getHolding, priorities } from '@kete/work';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { tell } from '../notifications/index.js';
import { isAdministrator } from '../rights/index.js';
import { KETE, mayManage, me, readable, refuse } from './access.js';
import { centerRouter, keteThreadOf } from './center.js';
import { citedStates, comfortRoutes, threadStore } from './comfort.js';
import { agentThreadRoutes } from './agent-routes.js';
import {
  agentRequests,
  agentSide,
  mentionedAgents,
  offerHolding,
  speakToAgent,
} from './agent-threads.js';
import { doorRoutes } from './door-routes.js';
import { mailOverview, mailRulesInput, originalsOf, setMailRules } from './mail-settings.js';
import { handedNow, pagesOf, proposalsOf, startTurn, workingTurn } from './door.js';
import { threadEvents } from './live.js';
import { listMailboxes, mailboxInput, MailboxError, mailboxOf, saveMailbox } from './mailboxes.js';
import { ensureObjectThreads } from './objects.js';
import {
  decideOutside,
  deliverOutside,
  mayWriteOutside,
  pendingOf,
  waitForApproval,
} from './outside.js';
import { actionsOf, namesOf, stateOf } from './state.js';
import { messageWords } from './words.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

let converterOverride: PdfConverter | null | undefined;
/** Tests: another conversion service (`null`: none). */
export function useThreadConverter(next: PdfConverter | null | undefined): void {
  converterOverride = next;
}

const ref = z.object({ kind: z.string().min(1).max(60), id: z.string().min(1).max(200) });
const who = z.object({ kind: z.enum(['person', 'agent']), id: z.string().min(1).max(100) });
const messageId = z.string().regex(/^msg_[0-9A-Za-z_-]{8,70}$/);
const fileId = z.string().regex(/^fil_[0-9A-Za-z_-]{8,70}$/);

const openInput = z.object({
  kind: z.enum(['group', 'direct']),
  title: z.string().trim().min(1).max(200),
  members: z.array(who).max(200).default([]),
});

const postInput = z.object({
  text: z.string().trim().min(1).max(20000),
  for: z.enum(['action', 'information']).default('information'),
  to: who.optional(),
  due: z.iso.date().optional(),
  priority: z.enum(priorities as unknown as ['urgent', 'high', 'normal', 'low']).optional(),
  replyTo: messageId.optional(),
  mentions: z.array(who).max(50).default([]),
  /** The objects cited with « # » (spec 099, FR-006). */
  references: z
    .array(ref.extend({ app: z.string().min(1).max(60).optional() }))
    .max(20)
    .default([]),
  files: z.array(fileId).max(20).default([]),
  /** `outside`: said to the thread's contacts, through their channels (FR-005, FR-015). */
  visibility: z.enum(['internal', 'outside']).default('internal'),
});

/** Threads, under /v1/threads (specs 089, 098). */
export const threadRoutes = new Hono<{ Variables: IdentityVariables }>()
  // Her open threads, by last activity, with what she has not read (FR-003).
  .get('/', async (c: Ctx) => {
    const identity = c.get('identity');
    const answer = await transaction(identity.organizationId, async (db) => {
      await ensureObjectThreads(db, identity.organizationId);
      const threads = await threadSummariesOf(db, me(identity));
      const ids = threads.flatMap((t) => [t.thread.holder.id, t.last?.author.id ?? '']);
      return {
        threads,
        names: await namesOf(db, ids.filter(Boolean), identity, messageWords().outsider),
      };
    });
    return c.json(answer);
  })
  // What changes in her threads, as it happens (FR-004).
  .get('/events', (c: Ctx) => threadEvents(c))
  // The threads at today's level: pages, media, reactions, voice, « # », imports (spec 099).
  .route('/', comfortRoutes)
  // Kete's door: its turn, what it proposes, her invitation (FR-007 to FR-011).
  .route('/', doorRoutes)
  // Her agents as colleagues: their threads, their job, what they ask (FR-013 to FR-016).
  .route('/', agentThreadRoutes)
  // A group or a direct thread she opens and holds, with its members (FR-008).
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
  // Words in the threads she reads; each hit with its thread's title (FR-003).
  .get('/search', async (c: Ctx) => {
    const identity = c.get('identity');
    const text = (c.req.query('q') ?? '').trim();
    if (text.length < 2) throw new GestureRefusal(422, 'invalid_input', 'Two letters at least.');
    const found = await transaction(identity.organizationId, async (db) => {
      const mine = await threadSummariesOf(db, me(identity));
      const titles = new Map(mine.map((t) => [t.thread.id, t.thread.title]));
      const hits = await searchMessages(db, { text, limit: 50 });
      const shown = isAdministrator(identity) ? hits : hits.filter((m) => titles.has(m.thread));
      const names = await namesOf(
        db,
        shown.map((m) => m.author.id),
        identity,
        messageWords().outsider,
      );
      return shown.map((m) => ({
        ...m,
        threadTitle: titles.get(m.thread) ?? '',
        authorName: names[m.author.id] ?? '',
      }));
    });
    return c.json({ messages: found });
  })
  // An object's thread: a project's or a third party's opens if it has none yet (FR-010).
  .get('/of/:kind/:id', async (c: Ctx) => {
    const identity = c.get('identity');
    const object = ref.parse({ kind: c.req.param('kind'), id: c.req.param('id') });
    const thread = await transaction(identity.organizationId, async (db) => {
      if (object.kind === 'project' || object.kind === 'party') {
        await ensureObjectThreads(db, identity.organizationId);
      }
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
  // What Kete reads and how it ranges: the boxes, the routing steps this week (spec 099, FR-018).
  .get('/mailboxes/overview', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) throw new GestureRefusal(403, 'forbidden', 'Administrators.');
    return c.json(await transaction(identity.organizationId, (db) => mailOverview(db)));
  })
  // A box shared and read whole, or personal and read by the three rules; its Sent folder too.
  .post('/mailboxes/:userId/rules', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity)) throw new GestureRefusal(403, 'forbidden', 'Administrators.');
    const parsed = mailRulesInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What Kete reads.');
    const set = await transaction(identity.organizationId, (db) =>
      setMailRules(db, c.req.param('userId') ?? '', parsed.data),
    );
    if (!set) throw new GestureRefusal(404, 'not_found', 'No such mailbox.');
    return c.json({ rules: parsed.data });
  })
  // A file of a thread, for its members (FR-006).
  .get('/files/:fileId', async (c: Ctx) => {
    const identity = c.get('identity');
    const id = fileId.safeParse(c.req.param('fileId'));
    if (!id.success) throw new GestureRefusal(404, 'not_found', 'No such file.');
    const file = await transaction(identity.organizationId, async (db) => {
      const store = threadStore();
      const found = await threadFile(db, id.data, store ? { store } : {});
      if (!found) throw new GestureRefusal(404, 'not_found', 'No such file.');
      await readable(db, identity, found.thread);
      return found;
    });
    const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(file.media_type);
    return c.body(new Uint8Array(file.content), 200, {
      'content-type': file.media_type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'x-content-type-options': 'nosniff',
    });
  })
  // A thread and its messages: she has read them as she opens it.
  .get('/:threadId', async (c: Ctx) => {
    const identity = c.get('identity');
    const threadId = c.req.param('threadId') ?? '';
    const view = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, threadId);
      // Where she stopped: the first message of someone else she had not read (FR-001).
      const { rows: unread } = await db.query<{ message_id: string }>(
        `select m.message_id from kete_messages m
            where m.thread_id = $1 and m.edited_from is null
              and not (m.author_kind = 'person' and m.author_id = $2)
              and not exists (select 1 from kete_message_reads r
                               where r.message_id = m.message_id and r.reader_kind = 'person'
                                 and r.reader_id = $2)
            order by m.at, m.message_id limit 1`,
        [threadId, identity.userId],
      );
      await markRead(db, identity.organizationId, { threadId, reader: me(identity) });
      const page = await messagesPage(db, threadId, {
        viewer: me(identity),
        ...(unread[0] ? { around: unread[0].message_id, limit: 80 } : {}),
      });
      const messages = page.messages;
      const { rows: runs } = await db.query<{
        message_id: string;
        title: string;
        steps: unknown[];
        seconds: number | null;
      }>(`select message_id, title, steps, seconds from thread_runs where message_id = any($1)`, [
        messages.map((m) => m.id),
      ]);
      const state = await stateOf(db, thread);
      const actions = await actionsOf(db, threadId);
      // What Kete proposed her here, the turn at work, and in her own thread what she handed.
      const proposals = await proposalsOf(db, threadId, identity.userId);
      const handed = thread.kind === 'kete' ? await handedNow(db, identity.userId) : [];
      const ids = [
        ...Object.values(proposals).flatMap((list) =>
          list.flatMap((p) =>
            'holdings' in p.body ? p.body.holdings.flatMap((h) => [h.holder, h.returnTo]) : [],
          ),
        ),
        ...(thread.members ?? []).map((m) => m.id),
        ...messages.flatMap((m) => [
          m.author.id,
          ...m.readBy.map((r) => r.id),
          ...(m.mentions ?? []).map((x) => x.id),
        ]),
        ...Object.values(actions).map((a) => a.holder.id),
        ...state.holdings.map((h) => h.holder.id),
        ...state.cards.map((h) => h.holder.id),
        ...state.files.flatMap((f) => f.versions.map((v) => v.by)),
      ];
      return {
        thread,
        messages,
        older: page.older,
        unreadFrom: unread[0]?.message_id ?? null,
        runs: Object.fromEntries(runs.map((r) => [r.message_id, r])),
        cited: await citedStates(
          db,
          messages.flatMap((m) => m.references ?? []),
        ),
        level: await notifyLevelOf(db, threadId, me(identity)),
        proposals,
        pages: await pagesOf(
          db,
          messages.map((m) => m.first),
        ),
        turn: await workingTurn(db, threadId),
        // A mail shows cleaned; its original, one tap away (FR-018).
        originals: await originalsOf(db, threadId, messages),
        agent: await agentSide(db, identity, thread),
        handed,
        actions,
        pending: await pendingOf(db, threadId),
        ...state,
        names: await namesOf(db, ids, identity, messageWords().outsider),
        mailbox: (await mailboxOf(db, identity.userId)) !== null,
      };
    });
    // What its agent asks, under its answers: read as she may decide it (FR-015).
    return c.json({
      ...view,
      requests: view.agent ? await agentRequests(identity, threadId) : {},
    });
  })
  // She marks it unread from a message on (FR-003).
  .post('/:threadId/unread', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z.object({ from: messageId }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'From which message?');
    await transaction(identity.organizationId, async (db) => {
      await readable(db, identity, c.req.param('threadId') ?? '');
      await markUnread(db, identity.organizationId, {
        messageId: parsed.data.from,
        reader: me(identity),
      });
    }).catch(refuse);
    return c.json({ ok: true });
  })
  // Its holder adds and removes members (FR-008).
  .post('/:threadId/members', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({
        add: z
          .array(who.extend({ role: z.enum(['member', 'subscriber']).optional() }))
          .max(50)
          .default([]),
        remove: z.array(who).max(50).default([]),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Who joins, who leaves.');
    const thread = await transaction(identity.organizationId, async (db) => {
      const found = await readable(db, identity, c.req.param('threadId') ?? '');
      mayManage(identity, found);
      for (const { role, ...member } of parsed.data.add) {
        await joinThread(
          db,
          identity.organizationId,
          found.id,
          role ? { ...member, role } : member,
        );
      }
      for (const member of parsed.data.remove) {
        if (member.kind === found.holder.kind && member.id === found.holder.id) continue;
        await leaveThread(db, found.id, member);
      }
      return getThread(db, found.id);
    });
    return c.json({ thread });
  })
  // A file joins the thread, read from its base64; the same name again is its next version.
  .post('/:threadId/files', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(200),
        contentType: z.string().max(100).default('application/octet-stream'),
        data: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_THREAD_FILE_BYTES * 4) / 3) + 8),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'A file of 100 MB at most.');
    const content = new Uint8Array(Buffer.from(parsed.data.data, 'base64'));
    const saved = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      const store = threadStore();
      return saveThreadFile(
        db,
        identity.organizationId,
        {
          threadId: thread.id,
          name: parsed.data.name,
          mediaType: parsed.data.contentType,
          content,
          by: me(identity),
        },
        new Date(),
        store ? { store } : {},
      );
    }).catch(refuse);
    return c.json({ file: saved }, 201);
  })
  // A message: for action (to whom, by when, how urgent) or for information; internal, or to
  // the outside through the policies; with its files, mentions and quoted answer.
  .post('/:threadId/messages', async (c: Ctx) => {
    const identity = c.get('identity');
    const threadId = c.req.param('threadId') ?? '';
    const parsed = postInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Some words.');
    const input = parsed.data;
    const words = messageWords();
    // The thread it was said in, for Kete's turn after.
    const place = { kind: '', holder: '' };
    const answer = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, threadId);
      place.kind = thread.kind;
      place.holder = thread.holder.id;
      const verdict =
        input.visibility === 'outside'
          ? await mayWriteOutside(db, identity.organizationId, { thread, userId: identity.userId })
          : null;
      if (verdict?.effect === 'refuse') {
        throw new GestureRefusal(
          403,
          'refused_by_policy',
          verdict.policies.map((p) => p.reason).join(' · ') || 'Refused by a policy.',
        );
      }
      const files = new Map(
        (await Promise.all(input.files.map((id) => threadFileInfo(db, id))))
          .filter((f): f is NonNullable<typeof f> => f !== null && f.thread === thread.id)
          .map((f) => [f.id, f]),
      );
      const posted = await postMessage(
        db,
        identity.organizationId,
        {
          thread: threadId,
          author: me(identity),
          text: input.text,
          for: input.for,
          visibility: input.visibility,
          ...(input.to ? { to: input.to } : {}),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          ...(input.mentions.length > 0 ? { mentions: input.mentions } : {}),
          ...(input.references.length > 0
            ? { references: input.references as NonNullable<Message['references']> }
            : {}),
          ...(files.size > 0
            ? {
                attachments: [...files.values()].map((f) => ({
                  id: f.id,
                  name: f.name,
                  media_type: f.media_type,
                  bytes: f.bytes,
                })) as NonNullable<Message['attachments']>,
              }
            : {}),
          via: 'kete',
        },
        new Date(),
        {
          ...(input.due ? { due: input.due } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        },
      ).catch(refuse);
      // A holding given to someone: her agent proposes to take it on, or takes it (FR-016).
      if (posted.holdingId && input.to?.kind === 'person') {
        await offerHolding(db, identity.organizationId, {
          holdingId: posted.holdingId,
          holder: input.to.id,
          what: input.text,
          threadId: thread.id,
          messageId: posted.message.id,
        });
      }
      // Who is mentioned, and who must act, is told (FR-014).
      const told = new Set<string>();
      const href = `/fils?fil=${thread.id}#${posted.message.id}`;
      if (
        input.for === 'action' &&
        input.to?.kind === 'person' &&
        input.to.id !== identity.userId
      ) {
        told.add(input.to.id);
        await tell(
          db,
          identity.organizationId,
          input.to.id,
          { kind: 'thread.action', title: words.forYou(identity.name, thread.title), href },
          { push: false },
        );
      }
      for (const mentioned of input.mentions) {
        if (mentioned.kind !== 'person' || mentioned.id === identity.userId) continue;
        if (told.has(mentioned.id)) continue;
        await tell(
          db,
          identity.organizationId,
          mentioned.id,
          { kind: 'thread.mentioned', title: words.mentioned(identity.name, thread.title), href },
          { push: false },
        );
      }
      if (verdict?.effect === 'approve') {
        await waitForApproval(db, identity.organizationId, {
          message: posted.message,
          thread,
          approvers: verdict.approvers,
          policies: verdict.policies,
        });
        for (const approver of verdict.approvers) {
          await tell(db, identity.organizationId, approver, {
            kind: 'thread.approval',
            title: words.toApprove(identity.name, thread.title),
            href,
          });
        }
        return { ...posted, delivered: null, waiting: verdict.approvers };
      }
      const delivered =
        input.visibility === 'outside'
          ? await deliverOutside(db, identity.organizationId, {
              message: posted.message,
              authorId: identity.userId,
            })
          : null;
      return { ...posted, delivered, waiting: [] as string[] };
    });
    // Kete takes its turn once her message is there: asked by « @Kete » or in her own thread
    // « Kete » (FR-007, FR-009); unasked, it reads a message that gives orders in a group, and
    // speaks only to propose, to her alone (FR-010, FR-011, case B).
    const asked =
      input.mentions.some((m) => m.kind === 'agent' && m.id === KETE.id) ||
      (place.kind === 'kete' && place.holder === identity.userId);
    const orders =
      place.kind !== 'kete' &&
      input.visibility === 'internal' &&
      input.mentions.some((m) => m.kind === 'person' && m.id !== identity.userId);
    // In an agent's thread, her words are its work; mentioned elsewhere, it sets to work there
    // unless its job description says never (FR-013, FR-016).
    const agentWork = await transaction(identity.organizationId, async (db) => {
      const said = await speakToAgent(db, identity, threadId, input.text);
      if (said) return said;
      const mentioned = input.mentions
        .filter((m) => m.kind === 'agent' && m.id !== KETE.id)
        .map((m) => m.id);
      return (
        (
          await mentionedAgents(db, identity, { threadId, text: input.text, agents: mentioned })
        )[0] ?? null
      );
    });
    const turn =
      agentWork ??
      (asked || orders
        ? startTurn(identity, { threadId, question: input.text, review: !asked })
        : null);
    return c.json({ ...answer, turn }, 201);
  })
  // « Créer… »: Kete prepares, from a message, the draft she asks for (FR-013).
  .post('/messages/:messageId/draft', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z.object({ what: z.string().trim().min(2).max(120) }).safeParse(await bodyOf(c));
    const id = messageId.safeParse(c.req.param('messageId'));
    if (!parsed.success || !id.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Which message, and what to make of it?');
    }
    const said = await transaction(identity.organizationId, async (db) => {
      const { rows } = await db.query<{ thread_id: string; text: string }>(
        `select thread_id, text from kete_messages where message_id = $1`,
        [id.data],
      );
      if (!rows[0]) throw new GestureRefusal(404, 'not_found', 'No such message.');
      await readable(db, identity, rows[0].thread_id);
      return rows[0];
    });
    const turn = startTurn(identity, {
      threadId: said.thread_id,
      question: `Prépare en brouillon : ${parsed.data.what}, à partir de ce message — « ${said.text.slice(0, 4000)} ». Dis ce que tu as préparé.`,
    });
    return c.json({ asked: true, turn }, 202);
  })
  // Its author edits it; the original is kept.
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
  // Its author or the thread's holder moves it to another of her threads (FR-006).
  .post('/messages/:messageId/move', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z
      .object({ to: z.string().regex(/^thr_[0-9A-Za-z_-]{8,70}$/) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'To which thread?');
    const message = await transaction(identity.organizationId, async (db) => {
      await readable(db, identity, parsed.data.to);
      return moveMessage(db, identity.organizationId, {
        messageId: c.req.param('messageId') ?? '',
        to: parsed.data.to,
        by: me(identity),
      });
    }).catch(refuse);
    return c.json({ message });
  })
  // An approver decides an outside message (FR-015).
  .post('/messages/:messageId/outside', async (c: Ctx) => {
    const identity = c.get('identity');
    const parsed = z.object({ approve: z.boolean() }).safeParse(await bodyOf(c));
    const id = messageId.safeParse(c.req.param('messageId'));
    if (!parsed.success || !id.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Approve or refuse.');
    }
    const decided = await transaction(identity.organizationId, (db) =>
      decideOutside(db, identity.organizationId, {
        messageId: id.data,
        by: identity.userId,
        approve: parsed.data.approve,
      }),
    );
    if (!decided) throw new GestureRefusal(404, 'not_found', 'Nothing waits for you here.');
    return c.json(decided);
  })
  // The holder of an action asked in a thread says it is done (FR-007).
  .post('/actions/:holdingId/done', async (c: Ctx) => {
    const identity = c.get('identity');
    const id = c.req.param('holdingId') ?? '';
    const done = await transaction(identity.organizationId, async (db) => {
      const holding = await getHolding(db, id);
      if (!holding || holding.source.app !== 'threads') {
        throw new GestureRefusal(404, 'not_found', 'No such action.');
      }
      if (holding.holder.id !== identity.userId && !isAdministrator(identity)) {
        throw new GestureRefusal(403, 'not_yours', 'Its holder says it is done.');
      }
      const finished = await finishHolding(db, identity.organizationId, id);
      // Returned to whom it says, when it is someone else (spec 099, FR-012).
      const back = finished?.returnTo;
      if (finished && back?.kind === 'person' && back.id !== identity.userId) {
        await tell(db, identity.organizationId, back.id, {
          kind: 'holding.returned',
          title: messageWords().returned(identity.name, finished.what),
          href: '/pour-moi',
        });
      }
      return finished;
    });
    return c.json({ holding: done });
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
