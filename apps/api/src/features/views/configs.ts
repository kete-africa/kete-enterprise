import { defineCommand } from '@kete/commands';
import type { View } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { checkView, resolveView, type ViewLayer } from '@kete/views/figures';
import { z } from 'zod';
import type { IdentityVariables } from '../../platform/identity.js';
import { defaultViewOf } from './defaults.js';

// Components configured where they are used (spec 103; doctrine D-062, R16, R22; kete-core ADR 0016
// and spec 145): a place's view in layers — Kete's default, the organization's, a position's, the
// person's own version. The most precise wins, whole. Every change keeps the version before it and
// is a journaled gesture, so it can be undone; Kete changes a view on a sentence the same way.

type Identity = IdentityVariables['identity'];

export function viewConfigsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.view_configs (
  organization_id text not null,
  place text not null check (place ~ '^[a-z][a-z0-9_-]{0,40}(:[a-z0-9_-]{1,80})?$'),
  level text not null check (level in ('organization', 'position', 'person')),
  -- The position's or the person's id; empty for the organization.
  owner text not null default '',
  view jsonb not null,
  version integer not null check (version >= 1),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, place, level, owner),
  check ((level = 'organization') = (owner = ''))
);
${policy('view_configs')}
grant select, insert, update, delete on ${s}.view_configs to ${options.appRole};

create table ${s}.view_config_versions (
  organization_id text not null,
  place text not null,
  level text not null,
  owner text not null,
  version integer not null,
  view jsonb,
  saved_by text not null,
  saved_at timestamptz not null default now(),
  primary key (organization_id, place, level, owner, version)
);
${policy('view_config_versions')}
grant select, insert on ${s}.view_config_versions to ${options.appRole};
`;
}

export class ViewRefusal extends Error {
  constructor(
    readonly code: 'invalid' | 'not_found' | 'forbidden',
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
  }
}

const place = z.string().regex(/^[a-z][a-z0-9_-]{0,40}(:[a-z0-9_-]{1,80})?$/);
const level = z.enum(['organization', 'position', 'person']);
const where = { place, level, owner: z.string().max(128).default('') };

/** The positions she holds today: a position's version reaches whoever holds it. */
async function positionsOf(db: SqlExecutor, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ position_id: string }>(
    `select a.position_id from assignments a join people p on p.person_id = a.person_id
      where p.account_user_id = $1 and a.starts_on <= current_date
        and (a.ends_on is null or a.ends_on >= current_date)
      order by a.kind = 'primary' desc`,
    [userId],
  );
  return rows.map((r) => r.position_id);
}

export interface PlacedView extends ViewLayer {
  owner: string;
}

/** Every layer of a place that reaches her, and the one she sees. */
export async function viewFor(
  db: SqlExecutor,
  identity: Identity,
  at: string,
): Promise<{ shown: PlacedView | null; layers: PlacedView[] }> {
  const positions = await positionsOf(db, identity.userId);
  const { rows } = await db.query<{
    level: ViewLayer['level'];
    owner: string;
    view: View;
    version: number;
  }>(
    `select level, owner, view, version from view_configs
      where place = $1 and (level = 'organization'
         or (level = 'position' and owner = any($2::text[]))
         or (level = 'person' and owner = $3))`,
    [at, positions, identity.userId],
  );
  const stored = rows
    .map((r) => ({ level: r.level, owner: r.owner, view: r.view, version: r.version }))
    // Among her positions, her primary one first.
    .sort((a, b) => positions.indexOf(a.owner) - positions.indexOf(b.owner));
  const fallback = await defaultViewOf(db, at);
  const layers: PlacedView[] = [
    ...stored,
    ...(fallback ? [{ level: 'app' as const, owner: '', view: fallback, version: 0 }] : []),
  ];
  return { shown: (resolveView(layers) as PlacedView | null) ?? null, layers };
}

async function current(db: SqlExecutor, at: { place: string; level: string; owner: string }) {
  const { rows } = await db.query<{ view: View; version: number }>(
    `select view, version from view_configs where place = $1 and level = $2 and owner = $3`,
    [at.place, at.level, at.owner],
  );
  return rows[0] ?? null;
}

async function keep(
  db: SqlExecutor,
  organizationId: string,
  at: { place: string; level: string; owner: string },
  view: View | null,
  by: string,
): Promise<number> {
  const before = await current(db, at);
  const { rows } = await db.query<{ version: number }>(
    `select coalesce(max(version), 0) + 1 as version from view_config_versions
      where place = $1 and level = $2 and owner = $3`,
    [at.place, at.level, at.owner],
  );
  const version = rows[0]?.version ?? (before ? before.version + 1 : 1);
  if (view) {
    await db.query(
      `insert into view_configs (organization_id, place, level, owner, view, version, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (organization_id, place, level, owner) do update
         set view = excluded.view, version = excluded.version, updated_by = excluded.updated_by,
             updated_at = now()`,
      [organizationId, at.place, at.level, at.owner, JSON.stringify(view), version, by],
    );
  } else {
    await db.query(`delete from view_configs where place = $1 and level = $2 and owner = $3`, [
      at.place,
      at.level,
      at.owner,
    ]);
  }
  await db.query(
    `insert into view_config_versions (organization_id, place, level, owner, version, view, saved_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, at.place, at.level, at.owner, version, view ? JSON.stringify(view) : null, by],
  );
  return version;
}

/**
 * A view set at one level of a place: checked against view.v1 where it is written. The version
 * before stays; « undo » restores it.
 */
export const setView = defineCommand({
  name: 'set-view',
  input: z.object({ ...where, view: z.unknown(), by: z.string().min(1).max(128) }),
  reversibility: { reversible: true, inverse: 'restore-view' },
  async handler(input, { db, organizationId }) {
    const checked = checkView(input.view);
    if (!checked.ok) throw new ViewRefusal('invalid', 'This view breaks view.v1.', checked.errors);
    const before = await current(db, input);
    const version = await keep(db, organizationId, input, checked.view, input.by);
    return {
      place: input.place,
      level: input.level,
      owner: input.owner,
      version,
      before: before?.version ?? null,
    };
  },
  summarize: (input) => `View of ${input.place} (${input.level}) changed`,
});

/** A layer back to one of its versions — or to nothing, the level below showing again. */
export const restoreView = defineCommand({
  name: 'restore-view',
  input: z.object({
    ...where,
    version: z.number().int().min(0).nullable(),
    by: z.string().min(1).max(128),
  }),
  reversibility: { reversible: true, inverse: 'restore-view' },
  async handler(input, { db, organizationId }) {
    let view: View | null = null;
    if (input.version) {
      const { rows } = await db.query<{ view: View | null }>(
        `select view from view_config_versions
          where place = $1 and level = $2 and owner = $3 and version = $4`,
        [input.place, input.level, input.owner, input.version],
      );
      if (!rows[0]) throw new ViewRefusal('not_found', 'No such version.');
      view = rows[0].view;
    }
    const before = await current(db, input);
    const version = await keep(db, organizationId, input, view, input.by);
    return {
      place: input.place,
      level: input.level,
      owner: input.owner,
      version,
      before: before?.version ?? null,
    };
  },
  summarize: (input) =>
    `View of ${input.place} (${input.level}) back to ${input.version ?? 'nothing'}`,
});

export async function versionsOf(
  db: SqlExecutor,
  at: { place: string; level: string; owner: string },
) {
  const { rows } = await db.query<{
    version: number;
    saved_by: string;
    saved_at: Date;
    cleared: boolean;
  }>(
    `select version, saved_by, saved_at, view is null as cleared from view_config_versions
      where place = $1 and level = $2 and owner = $3 order by version desc limit 50`,
    [at.place, at.level, at.owner],
  );
  return rows.map((r) => ({
    version: r.version,
    savedBy: r.saved_by,
    savedAt: r.saved_at.toISOString(),
    cleared: r.cleared,
  }));
}

/**
 * Her own version of a place, set for her — by her, or by Kete on a sentence (spec 103, FR-005):
 * a gesture of level 2, journaled, undone by going back to the version before.
 */
export const setMyView = defineCommand({
  name: 'set-my-view',
  input: z.object({ place, view: z.unknown() }),
  reversibility: { reversible: true, inverse: 'restore-view' },
  async handler(input, { db, organizationId, actor }) {
    const owner = actor.onBehalfOf?.id ?? actor.id;
    const checked = checkView(input.view);
    if (!checked.ok) throw new ViewRefusal('invalid', 'This view breaks view.v1.', checked.errors);
    const at = { place: input.place, level: 'person', owner };
    const before = await current(db, at);
    const version = await keep(db, organizationId, at, checked.view, actor.id);
    return { place: input.place, version, before: before?.version ?? null };
  },
  summarize: (input) => `Her own view of ${input.place}`,
});
