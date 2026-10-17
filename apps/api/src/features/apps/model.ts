import type { KeteIdentity } from '@kete/auth';
import { validateGesture, validateHolding, type Gesture, type Holding } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { syncSource } from '@kete/work';
import { z } from 'zod';
import { listResources } from '../registry/index.js';

// The apps on the living model (spec 091, kete-core spec 114): an app says every thing it holds,
// with its own token, and the center keeps them as holdings — in « Pour moi », relayed when their
// holder is away — finishing those it no longer says; before a gesture, it asks the organization's
// policies with the person's token, the same engine as the center's own gestures.

/** The most holdings an app says at once. */
export const HOLDINGS_LIMIT = 2000;

export class AppModelError extends Error {
  constructor(
    readonly code: 'unknown_app' | 'invalid' | 'unknown_gesture' | 'wrong_object',
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'AppModelError';
  }
}

/** The organization's active app of this product, when the registry holds it (under that client). */
async function activeApp(db: SqlExecutor, product: string, clientId?: string) {
  return (await listResources(db)).find(
    (r) =>
      r.kind === 'app' &&
      r.status === 'active' &&
      r.card?.product === product &&
      (clientId === undefined || r.card.client === clientId),
  );
}

export interface HoldingsOutcome {
  said: number;
  finished: number;
  /** What was not kept, and why: its holder is nobody the center knows. */
  refused: { kind: string; ref: string; reason: 'unknown_holder' }[];
}

/**
 * Keeps an app's holdings in step with what it says it holds now: only from the app the registry
 * holds under that client and product, each in the shape of `holding.v1` under its product. A
 * holding whose holder the center does not know is refused — never kept for nobody.
 */
export async function receiveAppHoldings(
  db: SqlExecutor,
  organizationId: string,
  clientId: string,
  input: { product: string; holdings: unknown[] },
  now = new Date(),
): Promise<HoldingsOutcome> {
  if (!(await activeApp(db, input.product, clientId))) {
    throw new AppModelError('unknown_app', 'No active app of this product under this client.');
  }
  if (input.holdings.length > HOLDINGS_LIMIT) {
    throw new AppModelError('invalid', `At most ${HOLDINGS_LIMIT} holdings at once.`);
  }
  const issues: string[] = [];
  const said: Holding[] = [];
  input.holdings.forEach((value, index) => {
    const checked = validateHolding(value);
    if (!checked.ok) issues.push(...checked.errors.map((e) => `#${index}: ${e}`));
    else if ((value as Holding).source.app !== input.product) {
      issues.push(`#${index}: its source is not ${input.product}.`);
    } else said.push(value as Holding);
  });
  if (issues.length > 0) {
    throw new AppModelError('invalid', 'Some holdings do not fit holding.v1.', issues.slice(0, 20));
  }

  const people = said.filter((h) => h.holder.kind === 'person').map((h) => h.holder.id);
  const agents = said.filter((h) => h.holder.kind === 'agent').map((h) => h.holder.id);
  const { rows: knownPeople } = await db.query<{ id: string }>(
    `select account_user_id as id from people where account_user_id = any($1)`,
    [[...new Set(people)]],
  );
  const { rows: knownAgents } = await db.query<{ id: string }>(
    `select agent_id as id from agents where agent_id = any($1)`,
    [[...new Set(agents)]],
  );
  const known = new Set([...knownPeople, ...knownAgents].map((r) => r.id));
  const refused: HoldingsOutcome['refused'] = [];
  const kept = said.filter((h) => {
    if (known.has(h.holder.id)) return true;
    refused.push({ kind: h.source.kind, ref: h.source.ref, reason: 'unknown_holder' });
    return false;
  });
  const result = await syncSource(db, organizationId, {
    app: input.product,
    said: kept,
    now,
  });
  return { ...result, refused };
}

const flat = z.union([z.string().max(200), z.number().int(), z.boolean()]);

export const appGestureInput = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  object: z.object({ kind: z.string().min(1).max(60), id: z.string().min(1).max(200) }),
  amount: z
    .object({ value: z.number().int().min(0), currency: z.string().regex(/^[A-Z]{3}$/) })
    .optional(),
  channel: z.string().min(1).max(40).optional(),
  party: z.string().min(1).max(100).optional(),
  context: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/), flat).optional(),
  /** The agent making it for the person whose token is given. */
  agent: z.object({ id: z.string().min(1).max(100) }).optional(),
});

export interface AppVerdict {
  effect: 'allow' | 'approve' | 'refuse' | 'unruled';
  policies: { id: string; sentence: string }[];
  approvers: { approver: string; people: string[] }[];
  reason?: string;
}

/**
 * The organization's policies on an app's gesture, for the person or her agent. Where nothing in
 * force speaks of the gesture, it is `unruled`: the app keeps its own rules. Otherwise the center's
 * engine decides and journals, as for its own gestures.
 */
export async function checkAppGesture(
  db: SqlExecutor,
  organizationId: string,
  identity: Pick<KeteIdentity, 'userId'>,
  product: string,
  input: z.infer<typeof appGestureInput>,
): Promise<AppVerdict> {
  if (!(await activeApp(db, product))) {
    throw new AppModelError('unknown_app', 'No active app of this product here.');
  }
  // Loaded when asked: the policies read the structure, whose features load the apps.
  const policies = await import('../policies/index.js');
  const { agent, amount, channel, party, context } = input;
  const gesture: Gesture = {
    kind: input.kind,
    object: input.object,
    ...(amount ? { amount } : {}),
    ...(channel ? { channel } : {}),
    ...(party ? { party } : {}),
    ...(context ? { context } : {}),
    actor: agent
      ? { kind: 'agent', id: agent.id, on_behalf_of: identity.userId }
      : { kind: 'person', id: identity.userId },
    at: new Date().toISOString(),
  };
  const checked = validateGesture(gesture);
  if (!checked.ok) throw new AppModelError('invalid', 'Not a gesture.', checked.errors);
  if (!policies.appGestures.includes(gesture.kind as never)) {
    throw new AppModelError('unknown_gesture', `The center does not rule « ${gesture.kind} ».`);
  }
  const ruled = await policies.ruledHere(db, gesture.kind);
  if (!ruled.spoken) {
    return { effect: 'unruled', policies: [], approvers: [], reason: 'nothing_ruled' };
  }
  try {
    const decision = await policies.decideFor(db, organizationId, gesture, {
      appRules: !ruled.allowed,
    });
    return {
      effect: decision.effect,
      policies: decision.policies.map((p) => ({ id: p.id, sentence: p.reason })),
      approvers:
        decision.effect === 'approve'
          ? await policies.approversFor(db, gesture, decision.approvers ?? [])
          : [],
    };
  } catch (error) {
    if (error instanceof policies.GestureError && error.code === 'wrong_object') {
      throw new AppModelError('wrong_object', error.message);
    }
    throw error;
  }
}
