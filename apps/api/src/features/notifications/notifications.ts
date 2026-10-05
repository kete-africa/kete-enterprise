import {
  listNotifications,
  markRead,
  notificationsMigrationSql,
  notify,
  pushSenderFromEnv,
  removePushSubscription,
  savePushSubscription,
  unreadCount,
  type PushSender,
} from '@kete/notify';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { onWaiting } from '../decisions/index.js';
import { notificationWords } from './words.js';

// What a person is told (spec 030), on @kete/notify: her notifications in Kete Enterprise, and on
// her phone or computer by Web Push when she asked for it. A notification informs; what asks for
// an action stays in « À faire ».

export function notificationsTablesSql(options: { schema: string; appRole: string }): string {
  return notificationsMigrationSql(options);
}

let sender: PushSender | null | undefined;

/** Tests: push another way. */
export function usePushSender(next: PushSender | null | undefined): void {
  sender = next;
}

function push(): PushSender | null {
  if (sender === undefined) sender = pushSenderFromEnv();
  return sender;
}

export interface Tell {
  kind:
    | 'decision.waiting'
    | 'schedule.answered'
    | 'task.added'
    | 'agent.signal'
    | 'agent.task'
    | 'app.ready';
  title: string;
  body?: string;
  href?: string;
}

/**
 * Tells a person, in the caller's transaction: kept in her notifications, pushed to her devices.
 * Telling never fails the gesture it follows.
 */
export async function tell(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  what: Tell,
): Promise<void> {
  await notify(db, { organizationId, userId, ...what }, push()).catch((error: unknown) => {
    console.error('[notifications]', (error as Error).message);
  });
}

let listening = false;

/** Listens to the product's events that tell people; called once, when the API starts. */
export function listenForNotifications(): void {
  if (listening) return;
  listening = true;
  // A request reaches a step: its approvers are told, in its transaction.
  onWaiting(async (db, organizationId, request, approvers) => {
    for (const userId of approvers) {
      await tell(db, organizationId, userId, {
        kind: 'decision.waiting',
        title: notificationWords().decisionWaiting(request.title),
        href: '/a-faire',
      });
    }
  });
}

const subscription = z.object({
  endpoint: z.string().url().startsWith('https://').max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Her notifications, under /v1/notifications. */
export const notificationRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    const { notifications, unread } = await transaction(organizationId, async (db) => ({
      notifications: await listNotifications(db, userId, { limit: 40 }),
      unread: await unreadCount(db, userId),
    }));
    return c.json({ notifications, unread, pushKey: push()?.publicKey ?? null });
  })
  .post('/read', async (c) => {
    const parsed = z
      .object({
        ids: z.array(z.string().min(4).max(80)).max(100).optional(),
        all: z.boolean().optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
      throw new GestureRefusal(422, 'invalid_input', 'Which ones?');
    }
    const { organizationId, userId } = c.get('identity');
    const read = await transaction(organizationId, (db) =>
      markRead(db, userId, parsed.data.all ? 'all' : (parsed.data.ids ?? [])),
    );
    return c.json({ read }, 201);
  })
  // A device of hers asks to be told (Web Push), never while an administrator views her space.
  .post('/push', async (c) => {
    if (c.get('viewedBy'))
      throw new GestureRefusal(403, 'view_as_forbidden', 'Her devices are hers.');
    if (!push()) throw new GestureRefusal(409, 'push_off', 'This instance sends no push yet.');
    const parsed = subscription.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A push subscription.');
    const identity = c.get('identity');
    await transaction(identity.organizationId, (db) =>
      savePushSubscription(db, identity, parsed.data),
    );
    return c.json({ subscribed: true }, 201);
  })
  .post('/push/remove', async (c) => {
    const parsed = z.object({ endpoint: z.string().url() }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Which device?');
    const { organizationId, userId } = c.get('identity');
    const removed = await transaction(organizationId, (db) =>
      removePushSubscription(db, userId, parsed.data.endpoint),
    );
    return c.json({ removed });
  });
