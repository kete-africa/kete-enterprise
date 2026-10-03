import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

/**
 * A person asks for an app (spec 021): what it is for, who uses it, its data, what an outage costs.
 * IT decides; once approved, the factory creates it and reports each step. Row-level security in
 * the same migration (constitution V).
 */
export function appRequestsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.app_requests (
  request_id text primary key,
  organization_id text not null,
  requester_user_id text not null,
  requester_name text not null,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{2,30}$'),
  name text not null check (length(name) between 1 and 80),
  purpose text not null check (length(purpose) between 20 and 4000),
  users text not null check (length(users) between 1 and 1000),
  data_categories text[] not null,
  criticality text not null check (criticality in ('low', 'medium', 'high', 'critical')),
  owner_contact text not null,
  status text not null default 'submitted' check (status in
    ('submitted', 'refused', 'withdrawn', 'queued', 'building', 'ready', 'coding', 'review', 'failed')),
  decided_by text,
  decided_at timestamptz,
  refusal_reason text,
  repository text,
  url text,
  pull_request text,
  error text,
  resource_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
create index app_requests_status on ${s}.app_requests (organization_id, status, created_at desc);
${organizationPolicySql({ schema: s, table: 'app_requests', appRole: options.appRole })}
grant select, insert, update on ${s}.app_requests to ${options.appRole};
`;
}

export const dataCategories = [
  'none',
  'personal',
  'special',
  'children',
  'financial',
  'payment',
  'location',
  'credentials',
  'confidential',
] as const;

export const appRequestInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,30}$/),
  name: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(20).max(4000),
  users: z.string().trim().min(1).max(1000),
  dataCategories: z.array(z.enum(dataCategories)).min(1),
  criticality: z.enum(['low', 'medium', 'high', 'critical']),
  ownerContact: z.string().email(),
});

export type AppRequestStatus =
  | 'submitted'
  | 'refused'
  | 'withdrawn'
  | 'queued'
  | 'building'
  | 'ready'
  | 'coding'
  | 'review'
  | 'failed';

export interface AppRequest {
  requestId: string;
  requesterUserId: string;
  requesterName: string;
  slug: string;
  name: string;
  purpose: string;
  users: string;
  dataCategories: string[];
  criticality: 'low' | 'medium' | 'high' | 'critical';
  ownerContact: string;
  status: AppRequestStatus;
  decidedBy: string | null;
  refusalReason: string | null;
  repository: string | null;
  url: string | null;
  pullRequest: string | null;
  error: string | null;
  resourceId: string | null;
  createdAt: string;
}

export class AppRequestRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'wrong_step' | 'own_request' | 'duplicate' | 'not_yours',
    message: string,
  ) {
    super(message);
    this.name = 'AppRequestRuleError';
  }
}

type Row = {
  request_id: string;
  requester_user_id: string;
  requester_name: string;
  slug: string;
  name: string;
  purpose: string;
  users: string;
  data_categories: string[];
  criticality: AppRequest['criticality'];
  owner_contact: string;
  status: AppRequestStatus;
  decided_by: string | null;
  refusal_reason: string | null;
  repository: string | null;
  url: string | null;
  pull_request: string | null;
  error: string | null;
  resource_id: string | null;
  created_at: Date;
};

const toRequest = (r: Row): AppRequest => ({
  requestId: r.request_id,
  requesterUserId: r.requester_user_id,
  requesterName: r.requester_name,
  slug: r.slug,
  name: r.name,
  purpose: r.purpose,
  users: r.users,
  dataCategories: r.data_categories,
  criticality: r.criticality,
  ownerContact: r.owner_contact,
  status: r.status,
  decidedBy: r.decided_by,
  refusalReason: r.refusal_reason,
  repository: r.repository,
  url: r.url,
  pullRequest: r.pull_request,
  error: r.error,
  resourceId: r.resource_id,
  createdAt: r.created_at.toISOString(),
});

export async function listAppRequests(
  db: SqlExecutor,
  filter: { requesterUserId?: string; status?: AppRequestStatus } = {},
): Promise<AppRequest[]> {
  const { rows } = await db.query<Row>(
    `select * from app_requests
      where ($1::text is null or requester_user_id = $1) and ($2::text is null or status = $2)
      order by created_at desc limit 200`,
    [filter.requesterUserId ?? null, filter.status ?? null],
  );
  return rows.map(toRequest);
}

export async function findAppRequest(db: SqlExecutor, requestId: string, lock = false) {
  const { rows } = await db.query<Row>(
    `select * from app_requests where request_id = $1 ${lock ? 'for update' : ''}`,
    [requestId],
  );
  return rows[0] ? toRequest(rows[0]) : null;
}

/** A person asks for an app; she may withdraw it until IT decides. */
export const submitAppRequest = defineCommand({
  name: 'submit-app-request',
  input: appRequestInput.extend({ requesterName: z.string().trim().min(1).max(160) }),
  reversibility: { reversible: true, inverse: 'withdraw-app-request' },
  async handler(input, { db, organizationId, actor }) {
    const requestId = newId('apr');
    const requester = actor.onBehalfOf?.id ?? actor.id;
    await db
      .query(
        `insert into app_requests (request_id, organization_id, requester_user_id, requester_name,
           slug, name, purpose, users, data_categories, criticality, owner_contact)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          requestId,
          organizationId,
          requester,
          input.requesterName,
          input.slug,
          input.name,
          input.purpose,
          input.users,
          input.dataCategories,
          input.criticality,
          input.ownerContact,
        ],
      )
      .catch((error: { code?: string }) => {
        if (error.code === '23505') {
          throw new AppRequestRuleError('duplicate', 'An app of that name was already asked for.');
        }
        throw error;
      });
    return { requestId };
  },
  summarize: (input) => `App « ${input.name} » (${input.slug}) asked for`,
});

export const withdrawAppRequest = defineCommand({
  name: 'withdraw-app-request',
  input: z.object({ requestId: z.string().regex(/^apr_[0-9a-z-]{8,64}$/) }),
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const request = await findAppRequest(db, input.requestId, true);
    if (!request) throw new AppRequestRuleError('not_found', 'No such request.');
    if (request.requesterUserId !== (actor.onBehalfOf?.id ?? actor.id)) {
      throw new AppRequestRuleError('not_yours', 'Only the person who asked withdraws.');
    }
    if (request.status !== 'submitted') {
      throw new AppRequestRuleError('wrong_step', 'It was already decided.');
    }
    await db.query(
      `update app_requests set status = 'withdrawn', updated_at = now() where request_id = $1`,
      [input.requestId],
    );
    return { requestId: input.requestId, status: 'withdrawn' };
  },
  summarize: (input) => `App request ${input.requestId} withdrawn`,
});

/** IT decides: approve (the factory will create it) or refuse with a reason. Never one's own. */
export const decideAppRequest = defineCommand({
  name: 'decide-app-request',
  input: z.object({
    requestId: z.string().regex(/^apr_[0-9a-z-]{8,64}$/),
    decision: z.enum(['approve', 'refuse']),
    reason: z.string().trim().min(1).max(1000).optional(),
  }),
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const request = await findAppRequest(db, input.requestId, true);
    if (!request) throw new AppRequestRuleError('not_found', 'No such request.');
    if (request.status !== 'submitted') {
      throw new AppRequestRuleError('wrong_step', 'It was already decided.');
    }
    if (request.requesterUserId === actor.id) {
      throw new AppRequestRuleError('own_request', 'Nobody decides her own request.');
    }
    const status = input.decision === 'approve' ? 'queued' : 'refused';
    await db.query(
      `update app_requests set status = $2, decided_by = $3, decided_at = now(),
         refusal_reason = $4, updated_at = now() where request_id = $1`,
      [
        input.requestId,
        status,
        actor.id,
        input.decision === 'refuse' ? (input.reason ?? null) : null,
      ],
    );
    return { requestId: input.requestId, status };
  },
  summarize: (input) => `App request ${input.requestId}: ${input.decision}`,
});

/** What the factory reports, recorded as it comes: the status and what it produced. */
export async function recordFactoryReport(
  db: SqlExecutor,
  report: {
    requestId: string;
    status: AppRequestStatus;
    repository: string | null;
    url: string | null;
    pullRequest: string | null;
    error: string | null;
  },
): Promise<AppRequest | null> {
  await db.query(
    `update app_requests set status = $2,
       repository = coalesce($3, repository), url = coalesce($4, url),
       pull_request = coalesce($5, pull_request), error = $6, updated_at = now()
     where request_id = $1`,
    [
      report.requestId,
      report.status,
      report.repository,
      report.url,
      report.pullRequest,
      report.error,
    ],
  );
  return findAppRequest(db, report.requestId);
}

export async function setResource(db: SqlExecutor, requestId: string, resourceId: string) {
  await db.query(`update app_requests set resource_id = $2 where request_id = $1`, [
    requestId,
    resourceId,
  ]);
}
