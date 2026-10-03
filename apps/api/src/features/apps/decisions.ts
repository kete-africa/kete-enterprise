import type { KeteIdentity } from '@kete/auth';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { findRequest, onDecided, openRequest, registerSubjectFamily } from '../decisions/index.js';
import { listResources } from '../registry/index.js';

// Decisions asked by apps (spec 023, kete-core spec 049): an app declares the subjects it asks
// decisions for in its card (`subjects`); it opens a request with the person's token; the circuits
// of the organization find the approver by the structure and the thresholds, interim included; a
// person decides in the Inbox; the app is told at its callback and reads the outcome with its own
// token. Nothing is shared but the request's id.

export function appDecisionsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
alter table ${s}.circuits drop constraint if exists circuits_subject_check;
alter table ${s}.circuits add constraint circuits_subject_check
  check (subject ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$');
create table ${s}.app_decisions (
  request_id text primary key,
  organization_id text not null,
  product text not null,
  subject text not null,
  reference text not null,
  callback_url text,
  told_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, request_id)
    references ${s}.decision_requests (organization_id, request_id)
);
${organizationPolicySql({ schema: s, table: 'app_decisions', appRole: options.appRole })}
grant select, insert, update on ${s}.app_decisions to ${options.appRole};
`;
}

const isAppSubject = (subject: string) => /^prd_[a-z0-9_]+\.[a-z][a-z0-9_]*$/.test(subject);

/** The subjects the organization's active apps declare, with their words. */
async function appSubjects(db: SqlExecutor) {
  const seen = new Set<string>();
  const found: { subject: string; label: { fr: string; en: string }; product: string }[] = [];
  for (const r of await listResources(db)) {
    if (r.kind !== 'app' || r.status !== 'active' || !r.card?.subjects) continue;
    for (const s of r.card.subjects) {
      const key = `${r.card.product}.${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        subject: key,
        product: r.card.product,
        label: { fr: `${r.name} · ${s.label.fr}`, en: `${r.name} · ${s.label.en}` },
      });
    }
  }
  return found;
}

// An app's request, once decided: the outcome is the request's own; the app is told after.
registerSubjectFamily(isAppSubject, async () => undefined, appSubjects);

export const appDecisionInput = z.object({
  subject: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  /** The app's own id of what is to be decided: one request per subject and reference. */
  reference: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  /** The amount or level the circuit's thresholds read. */
  measure: z.number().nonnegative().optional(),
  unitId: z
    .string()
    .regex(/^unt_[0-9a-f-]{8,64}$/)
    .optional(),
  /** Where the app is told the request was decided: only its id is sent. */
  callbackUrl: z.string().url().startsWith('https://').max(500).optional(),
});

export class AppDecisionError extends Error {
  constructor(
    readonly code: 'unknown_subject' | 'no_circuit' | 'duplicate',
    message: string,
  ) {
    super(message);
    this.name = 'AppDecisionError';
  }
}

/**
 * Opens a request for the app, as the person asks it: refused for a subject its card does not
 * declare, or when the organization has no circuit for it (the app decides by its own rules).
 */
export async function openAppDecision(
  db: SqlExecutor,
  organizationId: string,
  identity: Pick<KeteIdentity, 'userId'>,
  product: string,
  input: z.infer<typeof appDecisionInput>,
): Promise<{ requestId: string; status: 'pending' | 'approved' | 'refused' }> {
  const subject = `${product}.${input.subject}`;
  if (!(await appSubjects(db)).some((s) => s.subject === subject)) {
    throw new AppDecisionError('unknown_subject', `No active app declares ${subject}.`);
  }
  const requestId = await openRequest(db, organizationId, {
    subject,
    reference: input.reference,
    title: input.title,
    requesterUserId: identity.userId,
    unitId: input.unitId ?? null,
    measure: input.measure ?? null,
  }).catch((error: { code?: string }) => {
    if (error.code === '23505') {
      throw new AppDecisionError('duplicate', 'This reference was already asked for.');
    }
    throw error;
  });
  if (!requestId) throw new AppDecisionError('no_circuit', `No circuit decides ${subject} here.`);
  await db.query(
    `insert into app_decisions (request_id, organization_id, product, subject, reference, callback_url)
     values ($1, $2, $3, $4, $5, $6)`,
    [requestId, organizationId, product, subject, input.reference, input.callbackUrl ?? null],
  );
  const request = await findRequest(db, requestId);
  return { requestId, status: request?.status ?? 'pending' };
}

export interface AppDecision {
  requestId: string;
  subject: string;
  reference: string;
  status: 'pending' | 'approved' | 'refused';
  /** The last word given: who decided, and why when refused. */
  decidedBy: string | null;
  reason: string | null;
}

/** A request an app asked, as the app reads it: only its own product's. */
export async function appDecision(
  db: SqlExecutor,
  product: string,
  requestId: string,
): Promise<AppDecision | null> {
  const { rows } = await db.query<{ product: string; subject: string; reference: string }>(
    `select product, subject, reference from app_decisions where request_id = $1`,
    [requestId],
  );
  const row = rows[0];
  if (!row || row.product !== product) return null;
  const request = await findRequest(db, requestId);
  if (!request) return null;
  const last = [...request.steps].reverse().find((s) => s.decidedBy);
  return {
    requestId,
    subject: row.subject.slice(row.product.length + 1),
    reference: row.reference,
    status: request.status,
    decidedBy: last?.decidedBy ?? null,
    reason: request.status === 'refused' ? (last?.reason ?? null) : null,
  };
}

/** The product of the app whose client this is, in the organization's registry. */
export async function productOfClient(db: SqlExecutor, clientId: string): Promise<string | null> {
  const app = (await listResources(db)).find(
    (r) => r.kind === 'app' && r.status === 'active' && r.card?.client === clientId,
  );
  return app?.card?.product ?? null;
}

/** Tells the app its request was decided: its id only, the outcome read with the app's token. */
export function tellAppsWith(
  transaction: <T>(organizationId: string, work: (db: SqlExecutor) => Promise<T>) => Promise<T>,
): void {
  onDecided(async (organizationId, requestId) => {
    const callback = await transaction(organizationId, async (db) => {
      const { rows } = await db.query<{ callback_url: string | null }>(
        `update app_decisions set told_at = now() where request_id = $1 returning callback_url`,
        [requestId],
      );
      return rows[0]?.callback_url ?? null;
    });
    if (!callback) return;
    await fetch(callback, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, organizationId }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
  });
}
