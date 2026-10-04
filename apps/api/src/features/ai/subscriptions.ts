import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { readConnection, readPolicy } from './connections.js';

// A person's own AI subscription (spec 026b): the subscription she already pays for answers her,
// through its own agent signed in on her own isolated machine — never on Kete's servers. Kete
// Enterprise keeps only which machine is hers and whether she finished signing in: her sign-in
// stays on her machine, never in Kete.

export function aiSubscriptionsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.ai_subscriptions (
  organization_id text not null,
  user_id text not null,
  machine_id text not null check (machine_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  state text not null check (state in ('signing_in', 'connected')),
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  last_used_at timestamptz,
  primary key (organization_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'ai_subscriptions', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.ai_subscriptions to ${options.appRole};
`;
}

export interface Subscription {
  state: 'signing_in' | 'connected';
  createdAt: string;
  connectedAt: string | null;
  lastUsedAt: string | null;
}

/** The agent of a person's subscription, on her own machine. One adapter, in the infrastructure. */
export interface SubscriptionAgent {
  /** Whether this instance can give a person a machine of her own. */
  available(): boolean;
  /**
   * Starts her sign-in on her machine (created, or resumed when she has one): the address she
   * opens and the one-time code she enters there, valid 15 minutes.
   */
  startSignIn(machineId: string | null): Promise<{ machineId: string; url: string; code: string }>;
  /** Whether she finished signing in; null when her machine no longer exists. */
  signedIn(machineId: string): Promise<boolean | null>;
  /** Her subscription answers a prompt, with its images; read-only, without network for tools. */
  answer(
    machineId: string,
    input: { prompt: string; images: { data: Uint8Array; mediaType: string }[] },
  ): Promise<string>;
  /** Pauses her machine: kept with her sign-in, not billed. */
  rest(machineId: string): Promise<void>;
  /** Deletes her machine and her sign-in with it. */
  forget(machineId: string): Promise<void>;
}

/** Her subscription answers no more: signed out, or her machine is gone. */
export class SubscriptionLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionLostError';
  }
}

export async function readSubscription(
  db: SqlExecutor,
  userId: string,
): Promise<(Subscription & { machineId: string }) | null> {
  const { rows } = await db.query<{
    machine_id: string;
    state: Subscription['state'];
    created_at: Date;
    connected_at: Date | null;
    last_used_at: Date | null;
  }>(
    `select machine_id, state, created_at, connected_at, last_used_at from ai_subscriptions
      where user_id = $1`,
    [userId],
  );
  const r = rows[0];
  return r
    ? {
        machineId: r.machine_id,
        state: r.state,
        createdAt: r.created_at.toISOString(),
        connectedAt: r.connected_at?.toISOString() ?? null,
        lastUsedAt: r.last_used_at?.toISOString() ?? null,
      }
    : null;
}

/** What the person sees of her subscription: never her machine. */
export const shown = (s: (Subscription & { machineId: string }) | null): Subscription | null =>
  s
    ? {
        state: s.state,
        createdAt: s.createdAt,
        connectedAt: s.connectedAt,
        lastUsedAt: s.lastUsedAt,
      }
    : null;

export async function saveSigningIn(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  machineId: string,
): Promise<void> {
  await db.query(
    `insert into ai_subscriptions (organization_id, user_id, machine_id, state)
     values ($1, $2, $3, 'signing_in')
     on conflict (organization_id, user_id) do update
       set machine_id = $3, state = 'signing_in', created_at = now(), connected_at = null`,
    [organizationId, userId, machineId],
  );
}

export async function markConnected(db: SqlExecutor, userId: string): Promise<void> {
  await db.query(
    `update ai_subscriptions set state = 'connected', connected_at = now() where user_id = $1`,
    [userId],
  );
}

export async function markUsed(db: SqlExecutor, userId: string): Promise<void> {
  await db.query(`update ai_subscriptions set last_used_at = now() where user_id = $1`, [userId]);
}

export async function removeSubscription(db: SqlExecutor, userId: string): Promise<void> {
  await db.query(`delete from ai_subscriptions where user_id = $1`, [userId]);
}

/** Who pays for an answer: the organization, her own key, or her own subscription. */
export const payers = ['organization', 'key', 'subscription'] as const;
export type Payer = (typeof payers)[number];

/**
 * Who may pay for this person's answers, by the organization's policy — `off`: the organization
 * only; `allowed`: the organization, her key, her subscription; `required`: hers only. The first
 * is the one used when she does not choose.
 */
export async function payersFor(
  db: SqlExecutor,
  userId: string,
  options: { organizationModel: boolean; keys: boolean; subscriptions: boolean },
): Promise<Payer[]> {
  const policy = await readPolicy(db);
  const list: Payer[] = [];
  if (policy !== 'off') {
    if (options.keys && (await readConnection(db, userId))) list.push('key');
    if (options.subscriptions && (await readSubscription(db, userId))?.state === 'connected') {
      list.push('subscription');
    }
  }
  if (policy !== 'required' && options.organizationModel) {
    // Her own key comes first when she brought one (spec 026); the organization's model otherwise.
    list.splice(list.includes('key') ? 1 : 0, 0, 'organization');
  }
  return list;
}
