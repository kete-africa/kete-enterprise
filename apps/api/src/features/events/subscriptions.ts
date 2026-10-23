import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { findAgent } from '../agents/index.js';
import { kindsOf } from '../objects/index.js';
import { subscriptionInput, type Subscription } from './events.js';

// Who follows what (spec 101, FR-004): an agent follows a type of event, a kind of object, a state
// it reaches — data, declared once, changed by a gesture that is kept in the journal. The dispatcher
// reads them; nothing is coded per consumer.

export class SubscriptionRefusal extends Error {
  constructor(
    readonly code: 'not_found' | 'unknown_kind' | 'unknown_state',
    message: string,
  ) {
    super(message);
  }
}

type Row = {
  subscription_id: string;
  consumer: 'agent';
  consumer_id: string;
  type_pattern: string;
  object_kind: string | null;
  state: string | null;
  active: boolean;
};
const subscriptionOf = (r: Row): Subscription => ({
  subscriptionId: r.subscription_id,
  consumer: r.consumer,
  consumerId: r.consumer_id,
  type: r.type_pattern,
  objectKind: r.object_kind,
  state: r.state,
  active: r.active,
});

/** The subscriptions of the organization, or of one agent. */
export async function listSubscriptions(
  db: SqlExecutor,
  agentId?: string,
): Promise<Subscription[]> {
  const { rows } = await db.query<Row>(
    `select subscription_id, consumer, consumer_id, type_pattern, object_kind, state, active
       from event_subscriptions where ($1::text is null or consumer_id = $1)
      order by created_at`,
    [agentId ?? null],
  );
  return rows.map(subscriptionOf);
}

export async function findSubscription(db: SqlExecutor, id: string) {
  const { rows } = await db.query<Row>(
    `select subscription_id, consumer, consumer_id, type_pattern, object_kind, state, active
       from event_subscriptions where subscription_id = $1`,
    [id],
  );
  return rows[0] ? subscriptionOf(rows[0]) : null;
}

/** A kind and a state must be the organization's own: a subscription never waits on nothing. */
async function check(db: SqlExecutor, input: z.infer<typeof subscriptionInput>) {
  if (!(await findAgent(db, input.consumerId))) {
    throw new SubscriptionRefusal('not_found', 'No such agent here.');
  }
  if (!input.objectKind) return;
  const kind = (await kindsOf(db)).find((k) => k.kind === input.objectKind);
  if (!kind) throw new SubscriptionRefusal('unknown_kind', 'No such kind of object here.');
  if (input.state && !kind.states.some((s) => s.id === input.state)) {
    throw new SubscriptionRefusal('unknown_state', 'This kind of object has no such state.');
  }
}

/** An agent starts following events. */
export const followEvents = defineCommand({
  name: 'follow-events',
  input: subscriptionInput.extend({ createdBy: z.string().min(1).max(128) }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    await check(db, input);
    const id = newId('sub');
    await db.query(
      `insert into event_subscriptions (organization_id, subscription_id, consumer, consumer_id,
         type_pattern, object_kind, state, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        id,
        input.consumer,
        input.consumerId,
        input.type,
        input.objectKind ?? null,
        input.state ?? null,
        input.createdBy,
      ],
    );
    return { subscription: (await findSubscription(db, id)) as Subscription };
  },
});

/** A subscription stopped, or taken up again. */
export const setSubscription = defineCommand({
  name: 'set-subscription',
  input: z.object({ subscriptionId: z.string().min(1).max(100), active: z.boolean() }),
  reversibility: { reversible: true, inverse: 'set-subscription' },
  async handler(input, { db }) {
    const found = await findSubscription(db, input.subscriptionId);
    if (!found) throw new SubscriptionRefusal('not_found', 'No such subscription.');
    await db.query(`update event_subscriptions set active = $2 where subscription_id = $1`, [
      input.subscriptionId,
      input.active,
    ]);
    return { subscription: { ...found, active: input.active } };
  },
});
