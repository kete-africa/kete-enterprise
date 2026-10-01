import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type {
  IdentityCard,
  Promotion,
  Resource,
  ResourceKind,
  Risk,
  Tier,
} from '../registry.record.js';

/** Promotions decided through an approval circuit keep its request (spec 005). */
export function registryCircuitsMigrationSql(options: { schema: string }): string {
  const s = options.schema;
  return `
alter table ${s}.promotions add column decision_request_id text;
alter table ${s}.promotions add foreign key (organization_id, decision_request_id)
  references ${s}.decision_requests (organization_id, request_id);
`;
}

/** The registry's tables, with row-level security in the same migration (constitution V). */
export function registryMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  const tier = (prefix: string) => `${prefix}_kind text not null
    check (${prefix}_kind in ('personal', 'unit', 'organization')),
  ${prefix}_unit_id text,
  check ((${prefix}_kind = 'unit') = (${prefix}_unit_id is not null))`;
  return `
create table ${s}.resources (
  resource_id text primary key,
  organization_id text not null,
  kind text not null check (kind in ('app', 'skill', 'mcp', 'agent')),
  name text not null check (length(name) between 1 and 160),
  description text,
  address text check (address like 'https://%'),
  owner_user_id text not null,
  owner_name text not null,
  ${tier('tier')},
  status text not null default 'active' check (status in ('active', 'retired')),
  card jsonb,
  risk text not null default 'unknown' check (risk in ('unknown', 'low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  unique (organization_id, resource_id),
  foreign key (organization_id, tier_unit_id) references ${s}.units (organization_id, unit_id)
);
create index resources_owner on ${s}.resources (organization_id, owner_user_id);
${policy('resources')}

create table ${s}.promotions (
  promotion_id text primary key,
  organization_id text not null,
  resource_id text not null,
  ${tier('target')},
  requested_by text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused')),
  decided_by text,
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (organization_id, resource_id) references ${s}.resources (organization_id, resource_id),
  foreign key (organization_id, target_unit_id) references ${s}.units (organization_id, unit_id)
);
-- One pending request per resource at a time.
create unique index promotions_one_pending on ${s}.promotions (resource_id) where status = 'pending';
${policy('promotions')}

grant select, insert, update on ${s}.resources, ${s}.promotions to ${options.appRole};
`;
}

type ResourceRow = {
  resource_id: string;
  kind: ResourceKind;
  name: string;
  description: string | null;
  address: string | null;
  owner_user_id: string;
  owner_name: string;
  tier_kind: Tier['kind'];
  tier_unit_id: string | null;
  status: 'active' | 'retired';
  card: IdentityCard | null;
  risk: Risk;
  created_at: Date;
};
type PromotionRow = {
  promotion_id: string;
  resource_id: string;
  target_kind: Tier['kind'];
  target_unit_id: string | null;
  requested_by: string;
  status: Promotion['status'];
  decided_by: string | null;
  reason: string | null;
  created_at: Date;
  decision_request_id: string | null;
};

const tierOf = (kind: Tier['kind'], unitId: string | null): Tier =>
  kind === 'unit' ? { kind, unitId: unitId ?? '' } : { kind };

const toResource = (r: ResourceRow): Resource => ({
  resourceId: r.resource_id,
  kind: r.kind,
  name: r.name,
  description: r.description,
  address: r.address,
  ownerUserId: r.owner_user_id,
  ownerName: r.owner_name,
  tier: tierOf(r.tier_kind, r.tier_unit_id),
  status: r.status,
  card: r.card,
  risk: r.risk,
  createdAt: new Date(r.created_at).toISOString(),
});
const toPromotion = (r: PromotionRow): Promotion => ({
  promotionId: r.promotion_id,
  resourceId: r.resource_id,
  target: tierOf(r.target_kind, r.target_unit_id),
  requestedBy: r.requested_by,
  status: r.status,
  decidedBy: r.decided_by,
  reason: r.reason,
  createdAt: new Date(r.created_at).toISOString(),
  decisionRequestId: r.decision_request_id,
});

const resourceColumns = `resource_id, kind, name, description, address, owner_user_id, owner_name,
  tier_kind, tier_unit_id, status, card, risk, created_at`;
const promotionColumns = `promotion_id, resource_id, target_kind, target_unit_id, requested_by,
  status, decided_by, reason, created_at, decision_request_id`;

export async function insertResource(
  db: SqlExecutor,
  organizationId: string,
  input: {
    kind: ResourceKind;
    name: string;
    description?: string | undefined;
    address?: string | undefined;
    ownerUserId: string;
    ownerName: string;
    card: IdentityCard | null;
    risk: Risk;
  },
): Promise<Resource> {
  const { rows } = await db.query<ResourceRow>(
    `insert into resources (resource_id, organization_id, kind, name, description, address,
       owner_user_id, owner_name, tier_kind, card, risk)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'personal', $9, $10)
     returning ${resourceColumns}`,
    [
      newId('res'),
      organizationId,
      input.kind,
      input.name,
      input.description ?? null,
      input.address ?? null,
      input.ownerUserId,
      input.ownerName,
      input.card ? JSON.stringify(input.card) : null,
      input.risk,
    ],
  );
  return toResource(rows[0] as ResourceRow);
}

export async function findResource(db: SqlExecutor, resourceId: string): Promise<Resource | null> {
  const { rows } = await db.query<ResourceRow>(
    `select ${resourceColumns} from resources where resource_id = $1`,
    [resourceId],
  );
  return rows[0] ? toResource(rows[0]) : null;
}

export async function listResources(db: SqlExecutor): Promise<Resource[]> {
  const { rows } = await db.query<ResourceRow>(
    `select ${resourceColumns} from resources order by status, name`,
  );
  return rows.map(toResource);
}

export async function setCard(
  db: SqlExecutor,
  resourceId: string,
  card: IdentityCard | null,
  risk: Risk,
): Promise<void> {
  await db.query(`update resources set card = $2, risk = $3 where resource_id = $1`, [
    resourceId,
    card ? JSON.stringify(card) : null,
    risk,
  ]);
}

export async function setTier(db: SqlExecutor, resourceId: string, tier: Tier): Promise<void> {
  await db.query(`update resources set tier_kind = $2, tier_unit_id = $3 where resource_id = $1`, [
    resourceId,
    tier.kind,
    tier.kind === 'unit' ? tier.unitId : null,
  ]);
}

export async function retire(db: SqlExecutor, resourceId: string): Promise<void> {
  await db.query(`update resources set status = 'retired' where resource_id = $1`, [resourceId]);
}

export async function insertPromotion(
  db: SqlExecutor,
  organizationId: string,
  input: { resourceId: string; target: Tier; requestedBy: string },
): Promise<Promotion> {
  const { rows } = await db.query<PromotionRow>(
    `insert into promotions (promotion_id, organization_id, resource_id, target_kind,
       target_unit_id, requested_by)
     values ($1, $2, $3, $4, $5, $6) returning ${promotionColumns}`,
    [
      newId('prm'),
      organizationId,
      input.resourceId,
      input.target.kind,
      input.target.kind === 'unit' ? input.target.unitId : null,
      input.requestedBy,
    ],
  );
  return toPromotion(rows[0] as PromotionRow);
}

export async function findPromotion(
  db: SqlExecutor,
  promotionId: string,
): Promise<Promotion | null> {
  const { rows } = await db.query<PromotionRow>(
    `select ${promotionColumns} from promotions where promotion_id = $1`,
    [promotionId],
  );
  return rows[0] ? toPromotion(rows[0]) : null;
}

export async function listPendingPromotions(db: SqlExecutor): Promise<Promotion[]> {
  const { rows } = await db.query<PromotionRow>(
    `select ${promotionColumns} from promotions where status = 'pending' order by created_at`,
  );
  return rows.map(toPromotion);
}

export async function decide(
  db: SqlExecutor,
  promotionId: string,
  status: 'approved' | 'refused',
  decidedBy: string,
  reason: string | null,
): Promise<void> {
  await db.query(
    `update promotions set status = $2, decided_by = $3, reason = $4, decided_at = now()
      where promotion_id = $1`,
    [promotionId, status, decidedBy, reason],
  );
}

export async function linkRequest(
  db: SqlExecutor,
  promotionId: string,
  requestId: string,
): Promise<void> {
  await db.query(`update promotions set decision_request_id = $2 where promotion_id = $1`, [
    promotionId,
    requestId,
  ]);
}

/** A person's name in the structure, from her account. */
export async function nameOf(db: SqlExecutor, accountUserId: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string }>(
    `select name from people where account_user_id = $1`,
    [accountUserId],
  );
  return rows[0]?.name ?? null;
}
