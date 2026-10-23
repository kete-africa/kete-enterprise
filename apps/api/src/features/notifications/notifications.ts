import { randomUUID } from 'node:crypto';
import {
  attend,
  attentionMigrationSql,
  attentionOrganizationsWaiting,
  DEFAULT_ATTENTION,
  listNotifications,
  markRead,
  notificationsMigrationSql,
  quietUntil,
  ringPostponed,
  type AttentionPrefs,
  type AttentionWeight,
  type PushSender,
  pushSenderFromEnv,
  pushSubscriptionsOf,
  removePushSubscription,
  savePushSubscription,
  unreadCount,
} from '@kete/notify';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import { z } from 'zod';
import { getPool, transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { onTold, onWaiting } from '../decisions/index.js';
import { notificationWords } from './words.js';

// What a person is told (spec 030), on @kete/notify: her notifications in Kete Enterprise, and on
// her phone or computer by Web Push when she asked for it. A notification informs; what asks for
// an action stays in « À faire ». One attention model decides (spec 109; kete-core spec 151; doctrine
// D-062, R14): every path that tells someone goes through `tell`, which weighs the signal, keeps it
// once, and rings her devices at once or after her quiet hours — her own choices, kept when she
// opens « Pour moi ».

export function notificationsTablesSql(options: { schema: string; appRole: string }): string {
  return notificationsMigrationSql(options);
}

/** One attention model (spec 109): what each person was told, once; her choices, kept. */
export function attentionTablesSql(options: { schema: string; appRole: string }): string {
  return `${attentionMigrationSql(options)}
alter table ${options.schema}.people add column attention jsonb;`;
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
    | 'decision.informed'
    | 'decision.returned'
    | 'schedule.answered'
    | 'task.added'
    | 'agent.signal'
    | 'agent.task'
    | 'decision.comment'
    | 'app.ready'
    | 'routine.watch'
    | 'exchange.asked'
    | 'exchange.replied'
    | 'request.received'
    | 'request.taken'
    | 'request.waiting'
    | 'request.answered'
    | 'request.returned'
    | 'request.declined'
    | 'request.reminded'
    | 'holding.taken_over'
    | 'holding.handed_back'
    | 'holding.stuck'
    | 'holding.nudged'
    | 'thread.mentioned'
    | 'thread.action'
    | 'thread.approval'
    | 'thread.message'
    | 'holding.returned';
  title: string;
  body?: string;
  href?: string;
}

/** What asks her to act rings her; what she only needs to know waits in her list. */
const TO_ACT = new Set<Tell['kind']>([
  'task.added',
  'routine.watch',
  'holding.handed_back',
  'decision.waiting',
  'decision.returned',
  'request.received',
  'request.waiting',
  'request.reminded',
  'request.returned',
  'holding.taken_over',
  'holding.stuck',
  'holding.nudged',
  'holding.returned',
  'thread.mentioned',
  'thread.action',
  'thread.approval',
  'exchange.asked',
  'agent.signal',
]);

export const weightOf = (kind: Tell['kind']): AttentionWeight =>
  TO_ACT.has(kind) ? 'act' : 'know';

/** Her choices for her attention, as she last opened « Pour moi »; Kete's defaults before. */
export async function attentionOf(db: SqlExecutor, userId: string): Promise<AttentionPrefs> {
  const { rows } = await db.query<{ attention: Partial<AttentionPrefs> | null }>(
    `select attention from people where account_user_id = $1 limit 1`,
    [userId],
  );
  return { ...DEFAULT_ATTENTION, ...(rows[0]?.attention ?? {}) };
}

/** Keeps her choices for the worker, which has no token of hers (spec 109). */
export async function keepAttention(
  db: SqlExecutor,
  userId: string,
  prefs: AttentionPrefs,
): Promise<void> {
  await db.query(`update people set attention = $2 where account_user_id = $1`, [
    userId,
    JSON.stringify(prefs),
  ]);
}

/**
 * Tells a person, in the caller's transaction, through the one attention model (spec 109): kept
 * once in her notifications — by `key`, when what is told has one — and on her devices as its
 * weight and her quiet hours say. Telling never fails the gesture it follows.
 */
export async function tell(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  what: Tell,
  options: { push?: boolean; key?: string; weight?: AttentionWeight } = {},
): Promise<void> {
  const sender = options.push === false ? null : push();
  try {
    await attend(
      db,
      {
        organizationId,
        userId,
        ...what,
        weight: options.weight ?? weightOf(what.kind),
        key: options.key ?? `${what.kind}:${randomUUID()}`,
      },
      { prefs: await attentionOf(db, userId), push: sender },
    );
  } catch (error) {
    console.error('[notifications]', (error as Error).message);
  }
}

/** The worker's round: what her quiet hours held back rings once they end, unless read since. */
export async function ringAfterQuiet(): Promise<number> {
  const sender = push();
  let rung = 0;
  for (const organizationId of await attentionOrganizationsWaiting(getPool())) {
    rung += await transaction(organizationId, (db) => ringPostponed(db, sender)).catch(
      (error: unknown) => {
        console.error(`[notifications] ringing ${organizationId}`, (error as Error).message);
        return 0;
      },
    );
  }
  return rung;
}

/**
 * Rings her devices only, what she was already told in the app (spec 099, FR-005): a message of a
 * thread she has not read three minutes after it.
 */
export async function ring(
  db: SqlExecutor,
  userId: string,
  what: Pick<Tell, 'kind' | 'title' | 'body' | 'href'>,
): Promise<number> {
  const sender = push();
  if (!sender) return 0;
  // In her quiet hours a thread does not ring: it waits, unread, where she will read it.
  if (quietUntil(await attentionOf(db, userId), new Date())) return 0;
  let rung = 0;
  for (const device of await pushSubscriptionsOf(db, userId)) {
    const outcome = await sender
      .send(device, {
        title: what.title,
        body: what.body ?? '',
        href: what.href ?? '/',
        tag: what.kind,
      })
      .catch(() => 'failed' as const);
    if (outcome === 'sent') rung += 1;
  }
  return rung;
}

let listening = false;

/** Listens to the product's events that tell people; called once, when the API starts. */
export function listenForNotifications(): void {
  if (listening) return;
  listening = true;
  // A request reaches a step: its approvers are told, in its transaction.
  onWaiting(async (db, organizationId, request, approvers) => {
    const step = request.steps.find((s) => s.status === 'pending')?.position ?? 0;
    for (const userId of approvers) {
      await tell(
        db,
        organizationId,
        userId,
        {
          kind: 'decision.waiting',
          title: notificationWords().decisionWaiting(request.title),
          href: '/a-faire',
        },
        { key: `decision:${request.requestId}:${step}` },
      );
    }
  });
  // A step only informs its people; a request comes back to who asked (spec 075).
  onTold(async (db, organizationId, request, people, why) => {
    const words = notificationWords();
    for (const userId of people) {
      await tell(db, organizationId, userId, {
        kind: why === 'informed' ? 'decision.informed' : 'decision.returned',
        title:
          why === 'informed'
            ? words.decisionInformed(request.title)
            : words.decisionReturned(request.title, request.returned?.reason ?? ''),
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
