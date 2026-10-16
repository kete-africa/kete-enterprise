import {
  chatContactOf,
  chatLinkTokenOf,
  chatOrganizationsWaiting,
  chatOutboxMigrationSql,
  ChatOutboxError,
  connectChatSender,
  deliverChat,
  listChatSenders,
  queueChatReply,
  queueChatText,
  receiveChat,
  saveChatContact,
  setChatConsent,
  type ChatChannelName,
  type ChatHeardMessage,
  type ChatOutboxOptions,
  type ChatSenderInput,
} from '@kete/notify';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { getPool, transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runCommand } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import {
  announceDecided,
  decideRequest,
  DecisionRuleError,
  findRequest,
  onWaiting,
} from '../decisions/index.js';
import { hearFromOutside } from '../messages/index.js';
import { phoneWords } from './words.js';

// The center on a phone (spec 077): a person ties her WhatsApp or her Telegram to Kete Enterprise;
// what waits for her decision arrives there with two buttons, and her tap decides it — the same
// decision as in her Inbox, journaled as hers, through that channel. The organization connects
// its own number and bot (@kete/notify): nothing leaves to someone who did not tie her phone.

export function phoneMigrationSql(options: { schema: string; appRole: string }): string {
  return chatOutboxMigrationSql(options);
}

let options: ChatOutboxOptions = {};

/** Tests: channels in memory, another key. */
export function usePhoneChannels(next: ChatOutboxOptions): void {
  options = next;
}

/** A button's id: what it decides, on which request. */
const buttonOf = (decision: 'approve' | 'refuse', requestId: string) => `${decision}:${requestId}`;
const buttonPattern = /^(approve|refuse):(drq_[0-9a-f-]{8,64})$/;

let listening = false;

/** What waits for a person's decision is sent to her phone too, when she tied it. */
export function listenForPhones(): void {
  if (listening) return;
  listening = true;
  onWaiting(async (db, organizationId, request, approvers) => {
    const words = phoneWords();
    for (const userId of approvers) {
      const contact = await chatContactOf(db, userId);
      if (!contact?.consent) continue;
      await queueChatText(db, organizationId, {
        reference: userId,
        kind: 'decision',
        subject: request.requestId,
        text: words.waiting(request.title),
        actions: [
          { id: buttonOf('approve', request.requestId), label: words.approve },
          { id: buttonOf('refuse', request.requestId), label: words.refuse },
        ],
      });
    }
  });
}

/** Her tap: the decision is taken as hers, through her channel, or she is told why not. */
async function decideByReply(heard: ChatHeardMessage): Promise<void> {
  const words = phoneWords();
  const reply = (text: string) =>
    transaction(heard.organizationId, (db) =>
      queueChatReply(db, heard.organizationId, { to: heard.messageId, text }),
    );
  if (heard.intent === 'link') return reply(words.linked).then(() => undefined);
  if (heard.intent !== 'message') return;
  const tapped = buttonPattern.exec(heard.message.action ?? '');
  // Words, not a button: into its object's thread, or her thread « Kete » (spec 089).
  if (!tapped || !heard.reference) {
    await hearFromOutside(heard);
    return;
  }
  const [, decision, requestId] = tapped as unknown as [string, 'approve' | 'refuse', string];
  const request = await transaction(heard.organizationId, (db) => findRequest(db, requestId));
  try {
    await runCommand(
      heard.organizationId,
      { kind: 'person', id: heard.reference, channel: heard.message.channel },
      // The provider's own id: a message delivered twice decides once.
      `chat-${heard.message.providerMessageId}`,
      decideRequest,
      // A reply proves who she is, never that she administers: only her own steps.
      { requestId, decision, administrator: false },
    );
  } catch (error) {
    if (error instanceof GestureRefusal || error instanceof DecisionRuleError) {
      await reply(words.notYours);
      return;
    }
    throw error;
  }
  await announceDecided(heard.organizationId, requestId);
  await reply(
    decision === 'approve'
      ? words.approved(request?.title ?? '')
      : words.refused(request?.title ?? ''),
  );
}

/** A provider's webhook: whose account, checked with that organization's own secret. */
async function receive(channel: ChatChannelName, request: Request, account?: string) {
  const received = await receiveChat(request, {
    ...options,
    channel,
    lookup: getPool(),
    inOrganization: transaction,
    ...(process.env.KETE_WHATSAPP_VERIFY_TOKEN
      ? { verifyToken: process.env.KETE_WHATSAPP_VERIFY_TOKEN }
      : {}),
    ...(account ? { account } : {}),
  });
  for (const heard of received.heard) {
    await decideByReply(heard).catch((error: unknown) => {
      console.error('[phone]', (error as Error).message);
    });
  }
  return received.response;
}

/** The worker, every minute: what waits to leave, organization by organization. */
export async function deliverPhones(): Promise<number> {
  let sent = 0;
  for (const organizationId of await chatOrganizationsWaiting(getPool())) {
    const done = await transaction(organizationId, (db) => deliverChat(db, options));
    sent += done.sent;
  }
  return sent;
}

/** The providers' webhooks, under /public/chat: no account, each checked with its own secret. */
export const phoneWebhookRoutes = new Hono()
  .get('/whatsapp', (c) => receive('whatsapp', c.req.raw))
  .post('/whatsapp', (c) => receive('whatsapp', c.req.raw))
  .post('/telegram/:account', (c) => receive('telegram', c.req.raw, c.req.param('account')));

const phoneInput = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('whatsapp'),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ]{8,20}$/),
  }),
  z.object({ channel: z.literal('telegram') }),
]);

const senderInput = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('whatsapp'),
    phoneNumberId: z.string().trim().min(1).max(64),
    accessToken: z.string().min(1).max(1000),
    appSecret: z.string().min(1).max(200),
    label: z.string().trim().max(120).optional(),
  }),
  z.object({
    channel: z.literal('telegram'),
    botToken: z.string().min(1).max(200),
    webhookSecret: z.string().min(1).max(200),
    label: z.string().trim().max(120).optional(),
  }),
]);

/** A sender as @kete/notify takes it: a label only when one was given. */
function senderOf(input: z.output<typeof senderInput>): ChatSenderInput {
  const { label, ...rest } = input;
  return { ...rest, ...(label ? { label } : {}) } as ChatSenderInput;
}

async function myPhone(db: SqlExecutor, userId: string) {
  const contact = await chatContactOf(db, userId);
  return {
    tied: contact?.consent === true,
    channel: contact?.channel ?? null,
    senders: (await listChatSenders(db)).map((sender) => sender.channel),
  };
}

/** Her phone, and the organization's senders, under /v1/phone. */
export const phoneRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const identity = c.get('identity');
    return c.json(await transaction(identity.organizationId, (db) => myPhone(db, identity.userId)));
  })
  // She ties her phone — by a gesture of hers, never from a message she sent.
  .post('/', async (c) => {
    const identity = c.get('identity');
    const parsed = phoneInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'A channel, and a number for WhatsApp.');
    const link = await transaction(identity.organizationId, async (db) => {
      await saveChatContact(db, identity.organizationId, {
        reference: identity.userId,
        channel: parsed.data.channel,
        ...(parsed.data.channel === 'whatsapp' ? { phone: parsed.data.phone } : {}),
      });
      await setChatConsent(db, identity.userId, true);
      // Telegram cannot write first: she opens the bot with this code once.
      return parsed.data.channel === 'telegram' ? await chatLinkTokenOf(db, identity.userId) : null;
    });
    return c.json({ tied: true, channel: parsed.data.channel, link });
  })
  .post('/untie', async (c) => {
    const identity = c.get('identity');
    await transaction(identity.organizationId, (db) => setChatConsent(db, identity.userId, false));
    return c.json({ tied: false });
  })
  // The organization's own number or bot: its administrators connect it; its secrets are sealed.
  .post('/senders', async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity))
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    const parsed = senderInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'The sender is incomplete.');
    try {
      await transaction(identity.organizationId, (db) =>
        connectChatSender(db, identity.organizationId, senderOf(parsed.data), options),
      );
    } catch (error) {
      if (error instanceof ChatOutboxError)
        throw new GestureRefusal(409, error.code, error.message);
      throw error;
    }
    return c.json({ connected: parsed.data.channel });
  });
