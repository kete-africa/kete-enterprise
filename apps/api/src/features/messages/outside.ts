import { answerByChat, answerByMail, type ChatAnswer } from '@kete/channels';
import {
  chatChannelOf,
  queueChatReply,
  type ChatChannel,
  type ChatChannels,
  type ChatChannelName,
} from '@kete/notify';
import type { Message, Thread } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { getThread } from '@kete/threads';
import { sayHolding } from '@kete/work';
import { approversFor, decideFor, ruledHere } from '../policies/index.js';
import { settingsIn } from '../settings/index.js';
import { mailboxOf, senderOf } from './mailboxes.js';
import { partyOfThread } from './objects.js';

// Who speaks for the company (spec 098, FR-015, FR-016; doctrine D-058). A message to the outside is
// the gesture `message.client` on the thread's third party, through its channel, decided by the
// organization's policies — the same for a person and her agent. Allowed, it leaves: by mail from
// her own box, on WhatsApp within its 24 hours (else the organization's template), on Telegram.
// To approve, it waits for its approvers, and leaves once one of them approves; refused, it stays
// said in the thread, and never leaves.

export type Verdict =
  | { effect: 'allow' }
  | { effect: 'approve'; approvers: string[]; policies: { id: string; reason: string }[] }
  | { effect: 'refuse'; policies: { id: string; reason: string }[] };

/** The channel an outside message takes: its contacts' own, mail first. */
function channelOf(thread: Thread): string {
  const contacts = (thread.members ?? []).filter((m) => m.kind === 'contact' && !m.until);
  if (contacts.some((m) => m.id.startsWith('mail:'))) return 'mail';
  const chat = contacts.find((m) => /^(whatsapp|telegram):/.test(m.id));
  return chat ? (chat.id.split(':')[0] ?? 'mail') : 'mail';
}

/** The policies' verdict on saying something to the thread's outside, for this person. */
export async function mayWriteOutside(
  db: SqlExecutor,
  organizationId: string,
  input: { thread: Thread; userId: string; now?: Date },
): Promise<Verdict> {
  const party = await partyOfThread(db, input.thread);
  // No third party known: nothing the organization wrote speaks of it.
  if (!party) return { effect: 'allow' };
  const gesture = {
    kind: 'message.client',
    actor: { kind: 'person' as const, id: input.userId },
    object: { kind: 'party', id: party },
    channel: channelOf(input.thread),
    at: (input.now ?? new Date()).toISOString(),
    context: { approvedTemplate: false },
  };
  // Nothing the organization wrote speaks of it: she speaks, as before any policy (spec 091's
  // rule for the apps). Once a policy names it, the policies decide; a forbid or an approval alone
  // leaves the rest allowed.
  const ruled = await ruledHere(db, 'message.client');
  if (!ruled.spoken) return { effect: 'allow' };
  const decided = await decideFor(db, organizationId, gesture, { appRules: !ruled.allowed });
  const cited = decided.policies.map((p) => ({ id: p.id, reason: p.reason }));
  if (decided.effect === 'refuse') return { effect: 'refuse', policies: cited };
  if (decided.effect === 'approve') {
    const found = await approversFor(db, gesture, decided.approvers ?? []);
    const people = [...new Set(found.flatMap((a) => a.people))].filter((p) => p !== input.userId);
    return people.length > 0
      ? { effect: 'approve', approvers: people, policies: cited }
      : { effect: 'refuse', policies: cited };
  }
  return { effect: 'allow' };
}

/** The organization's chat channels, as `answerByChat` needs them: answers go through the outbox. */
async function channelsOf(db: SqlExecutor, organizationId: string): Promise<ChatChannels> {
  const one = async (name: ChatChannelName): Promise<ChatChannel | null> => {
    const own = await chatChannelOf(db, name);
    if (!own) return null;
    return {
      ...own,
      // Her answer is queued as a reply to her last message: delivered, and retried, by the worker.
      async sendText(to, text) {
        const { rows } = await db.query<{ message_id: string }>(
          `select message_id from kete_chat_messages
            where direction = 'in' and channel = $1 and address = $2
            order by created_at desc limit 1`,
          [name, to],
        );
        if (rows[0]) await queueChatReply(db, organizationId, { to: rows[0].message_id, text });
      },
    };
  };
  return { whatsapp: await one('whatsapp'), telegram: await one('telegram') };
}

export interface Delivered {
  mailed: string[];
  chat: ChatAnswer;
}

/** An outside message leaves to the thread's contacts, by their channels. */
export async function deliverOutside(
  db: SqlExecutor,
  organizationId: string,
  input: { message: Pick<Message, 'thread' | 'text'>; authorId: string },
): Promise<Delivered> {
  const thread = await getThread(db, input.message.thread);
  const contacts = (thread?.members ?? []).filter((m) => m.kind === 'contact' && !m.until);
  let mailed: string[] = [];
  if (contacts.some((m) => m.id.startsWith('mail:'))) {
    const account = await mailboxOf(db, input.authorId);
    if (account) {
      const sent = await answerByMail(db, {
        message: input.message,
        from: { address: account.address, ...(account.name ? { name: account.name } : {}) },
        ...senderOf(account),
      });
      mailed = sent.to;
    }
  }
  const empty: ChatAnswer = { sent: [], byTemplate: [], refused: [] };
  if (!contacts.some((m) => /^(whatsapp|telegram):/.test(m.id))) return { mailed, chat: empty };
  const template = (await settingsIn(db, organizationId)).value<string>('kete.whatsapp_template');
  const chat = await answerByChat(db, {
    message: input.message,
    channels: await channelsOf(db, organizationId),
    template: template
      ? (text) => ({ name: template, language: 'fr', parameters: [text.slice(0, 900)] })
      : null,
  });
  return { mailed, chat };
}

/** An outside message waits for its approvers: one holding each, kept until one decides. */
export async function waitForApproval(
  db: SqlExecutor,
  organizationId: string,
  input: { message: Message; thread: Thread; approvers: string[]; policies: unknown[] },
): Promise<void> {
  await db.query(
    `insert into outside_pending (organization_id, message_id, thread_id, approvers, policies)
     values ($1, $2, $3, $4, $5)`,
    [
      organizationId,
      input.message.id,
      input.thread.id,
      input.approvers,
      JSON.stringify(input.policies),
    ],
  );
  for (const approver of input.approvers) {
    await sayHolding(db, organizationId, {
      source: { app: 'threads', kind: 'outside', ref: `${input.message.id}:${approver}` },
      object: input.thread.object ?? { kind: 'thread', id: input.thread.id },
      what: `« ${input.message.text.slice(0, 200)} »`,
      holder: { kind: 'person', id: approver },
      state: 'held',
      for: 'action',
      href: `/fils?fil=${input.thread.id}#${input.message.id}`,
    });
  }
}

/** The outside messages of a thread waiting for an approval, or decided. */
export async function pendingOf(db: SqlExecutor, threadId: string) {
  const { rows } = await db.query<{
    message_id: string;
    approvers: string[];
    state: 'waiting' | 'sent' | 'refused';
    decided_by: string | null;
  }>(`select message_id, approvers, state, decided_by from outside_pending where thread_id = $1`, [
    threadId,
  ]);
  return Object.fromEntries(
    rows.map((r) => [
      r.message_id,
      { approvers: r.approvers, state: r.state, decidedBy: r.decided_by },
    ]),
  );
}

/** An approver decides: approved, the message leaves; refused, it stays in the thread only. */
export async function decideOutside(
  db: SqlExecutor,
  organizationId: string,
  input: { messageId: string; by: string; approve: boolean },
): Promise<{ state: 'sent' | 'refused'; delivered: Delivered | null } | null> {
  const { rows } = await db.query<{ approvers: string[]; thread_id: string }>(
    `select approvers, thread_id from outside_pending
      where message_id = $1 and state = 'waiting' for update`,
    [input.messageId],
  );
  const pending = rows[0];
  if (!pending || !pending.approvers.includes(input.by)) return null;
  const state = input.approve ? 'sent' : 'refused';
  await db.query(
    `update outside_pending set state = $2, decided_by = $3, decided_at = now()
      where message_id = $1`,
    [input.messageId, state, input.by],
  );
  await db.query(
    `update kete_holdings set state = 'done', done_at = now(), updated_at = now()
      where source_app = 'threads' and source_kind = 'outside' and source_ref like $1
        and state <> 'done'`,
    [`${input.messageId}:%`],
  );
  if (!input.approve) return { state, delivered: null };
  const { rows: said } = await db.query<{ text: string; author_id: string }>(
    `select text, author_id from kete_messages where message_id = $1`,
    [input.messageId],
  );
  const message = said[0];
  if (!message) return { state, delivered: null };
  const delivered = await deliverOutside(db, organizationId, {
    message: { thread: pending.thread_id, text: message.text },
    authorId: message.author_id,
  });
  return { state, delivered };
}
