import { emailSenderFromEnv, type EmailSender } from '@kete/notify';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { getPool, transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import { GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import {
  insertMail,
  listCaptured,
  markFailed,
  markSent,
  organizationsWithQueuedMail,
  readCaptured,
  takeQueued,
} from './infrastructure/mail.tables.js';

/**
 * Writes an e-mail in the caller's transaction (spec 010): it leaves only if the gesture commits.
 * In capture mode it never leaves, and lands in the test outbox.
 */
export function queueMail(
  db: SqlExecutor,
  organizationId: string,
  input: { to: string; subject: string; html: string; text: string; purpose: string },
): Promise<string> {
  return insertMail(db, organizationId, {
    ...input,
    status: env.mailMode === 'send' ? 'queued' : 'captured',
  });
}

let sender: EmailSender | undefined;

/** Tests: send through another adapter. */
export function useEmailSender(next: EmailSender): void {
  sender = next;
}

/** The worker's job: hands queued e-mails to the provider, organization by organization. */
export async function sendQueuedMail(batch = 20): Promise<number> {
  sender ??= emailSenderFromEnv();
  const current = sender;
  let sent = 0;
  for (const organizationId of await organizationsWithQueuedMail(getPool())) {
    await transaction(organizationId, async (db) => {
      for (const mail of await takeQueued(db, batch)) {
        try {
          await current.send({
            from: env.mailFrom,
            to: mail.to,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          });
          await markSent(db, mail.messageId);
          sent += 1;
        } catch (error) {
          await markFailed(db, mail.messageId, (error as Error).message);
        }
      }
    });
  }
  return sent;
}

/** The test outbox, under /v1/mail: what would have left, for the organization's administrators. */
export const mailRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', async (c, next) => {
    if (!isAdministrator(c.get('identity'))) {
      throw new GestureRefusal(403, 'forbidden', 'The test outbox is for administrators.');
    }
    await next();
  })
  .get('/outbox', async (c) => {
    const { organizationId } = c.get('identity');
    const messages = await transaction(organizationId, (db) => listCaptured(db));
    return c.json({ mode: env.mailMode, messages });
  })
  .get('/outbox/:messageId', async (c) => {
    const { organizationId } = c.get('identity');
    const message = await transaction(organizationId, (db) =>
      readCaptured(db, c.req.param('messageId')),
    );
    if (!message) throw new GestureRefusal(404, 'not_found', 'No such e-mail in the outbox.');
    return c.json(message);
  });
