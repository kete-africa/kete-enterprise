import { defineCommand } from '@kete/commands';
import { newId } from '@kete/records';
import type { SqlExecutor } from '@kete/tenancy';
import { joinThread, openThread } from '@kete/threads';
import { z } from 'zod';

// Places and assets (spec 100; doctrine D-056, D-062): two references of the center. An asset is
// what the organization installs or owns and keeps for years — a solar plant, a pump, a vehicle, a
// machine — born of a project, living on after it; a place is where things are. Each is an object:
// its thread is born with it, its row in the index follows it (by trigger), its axes rights it.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const projectId = z.string().regex(/^prj_[0-9a-f-]{8,64}$/);
const partyId = z.string().regex(/^pty_[0-9a-f-]{8,64}$/);
const unitId = z.string().regex(/^unt_[0-9a-f-]{8,64}$/);
const placeId = z.string().regex(/^plc_[0-9a-f-]{8,64}$/);
const assetId = z.string().regex(/^ast_[0-9a-f-]{8,64}$/);

export const assetStates = [
  'in_service',
  'alert',
  'maintenance',
  'out_of_service',
  'retired',
] as const;

/** One of its own figures, as the organization keeps it: « Puissance · 24 kWc ». */
const fact = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(80),
});

export class ObjectRefusal extends Error {
  constructor(
    readonly code: 'not_found' | 'unknown_reference',
    message: string,
  ) {
    super(message);
    this.name = 'ObjectRefusal';
  }
}

async function exists(db: SqlExecutor, table: string, column: string, id: string | undefined) {
  if (!id) return true;
  const { rows } = await db.query(`select 1 from ${table} where ${column} = $1`, [id]);
  return rows.length > 0;
}

async function checkReferences(
  db: SqlExecutor,
  input: {
    projectId?: string | undefined;
    partyId?: string | undefined;
    unitId?: string | undefined;
    placeId?: string | undefined;
  },
) {
  const checks: [string, string, string | undefined][] = [
    ['projects', 'project_id', input.projectId],
    ['parties', 'party_id', input.partyId],
    ['units', 'unit_id', input.unitId],
    ['places', 'place_id', input.placeId],
  ];
  for (const [table, column, id] of checks) {
    if (!(await exists(db, table, column, id))) {
      throw new ObjectRefusal('unknown_reference', `No such ${column.replace('_id', '')} here.`);
    }
  }
}

// ---- places ----

export const placeInput = z.object({
  name: z.string().trim().min(1).max(160),
  subtype: z.string().trim().max(60).optional(),
  address: z.string().trim().max(400).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  unitId: unitId.optional(),
  partyId: partyId.optional(),
});

export interface Place {
  placeId: string;
  name: string;
  subtype: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  unitId: string | null;
  partyId: string | null;
  status: 'active' | 'archived';
}

type PlaceRow = {
  place_id: string;
  name: string;
  subtype: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  unit_id: string | null;
  party_id: string | null;
  status: 'active' | 'archived';
};
const PLACE = `place_id, name, subtype, address, latitude, longitude, unit_id, party_id, status`;
const placeOf = (r: PlaceRow): Place => ({
  placeId: r.place_id,
  name: r.name,
  subtype: r.subtype,
  address: r.address,
  latitude: r.latitude === null ? null : Number(r.latitude),
  longitude: r.longitude === null ? null : Number(r.longitude),
  unitId: r.unit_id,
  partyId: r.party_id,
  status: r.status,
});

export async function findPlace(db: SqlExecutor, id: string): Promise<Place | null> {
  const { rows } = await db.query<PlaceRow>(`select ${PLACE} from places where place_id = $1`, [
    id,
  ]);
  return rows[0] ? placeOf(rows[0]) : null;
}

const actor = z.object({ userId: z.string().min(1).max(128) });

/** A place is born; its thread with it, held by who creates it. */
export const createPlace = defineCommand({
  name: 'create-place',
  input: placeInput.extend({ creator: actor }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    await checkReferences(db, input);
    const id = newId('plc');
    await db.query(
      `insert into places (organization_id, place_id, name, subtype, address, latitude, longitude,
         unit_id, party_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        organizationId,
        id,
        input.name,
        input.subtype ?? null,
        input.address ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.unitId ?? null,
        input.partyId ?? null,
        input.creator.userId,
      ],
    );
    const thread = await openThread(db, organizationId, {
      kind: 'object',
      object: { kind: 'place', id },
      title: input.name,
      holder: { kind: 'person', id: input.creator.userId },
    });
    await joinThread(db, organizationId, thread.id, { kind: 'person', id: input.creator.userId });
    return { place: (await findPlace(db, id)) as Place };
  },
});

export const updatePlace = defineCommand({
  name: 'update-place',
  input: placeInput.partial().extend({
    placeId,
    status: z.enum(['active', 'archived']).optional(),
  }),
  reversibility: { reversible: true, inverse: 'update-place' },
  async handler(input, { db }) {
    if (!(await findPlace(db, input.placeId)))
      throw new ObjectRefusal('not_found', 'No such place.');
    await checkReferences(db, input);
    const sets: string[] = [];
    const params: unknown[] = [input.placeId];
    const set = (column: string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    set('name', input.name);
    set('subtype', input.subtype);
    set('address', input.address);
    set('latitude', input.latitude);
    set('longitude', input.longitude);
    set('unit_id', input.unitId);
    set('party_id', input.partyId);
    set('status', input.status);
    if (sets.length > 0) {
      await db.query(
        `update places set ${sets.join(', ')}, updated_at = now() where place_id = $1`,
        params,
      );
    }
    return { place: (await findPlace(db, input.placeId)) as Place };
  },
});

// ---- assets ----

export const assetInput = z.object({
  name: z.string().trim().min(1).max(160),
  subtype: z.string().trim().max(60).optional(),
  state: z.enum(assetStates).default('in_service'),
  partyId: partyId.optional(),
  projectId: projectId.optional(),
  unitId: unitId.optional(),
  /** Who answers for it: an account's user id. Default: who creates it. */
  holderUserId: z.string().min(1).max(128).optional(),
  placeId: placeId.optional(),
  serial: z.string().trim().max(120).optional(),
  commissionedOn: day.optional(),
  warrantyUntil: day.optional(),
  facts: z.array(fact).max(20).default([]),
});

export interface Asset {
  assetId: string;
  name: string;
  subtype: string | null;
  state: (typeof assetStates)[number];
  partyId: string | null;
  projectId: string | null;
  unitId: string | null;
  holderUserId: string | null;
  placeId: string | null;
  serial: string | null;
  commissionedOn: string | null;
  warrantyUntil: string | null;
  facts: { label: string; value: string }[];
  createdAt: string;
}

type AssetRow = {
  asset_id: string;
  name: string;
  subtype: string | null;
  state: Asset['state'];
  party_id: string | null;
  project_id: string | null;
  unit_id: string | null;
  holder_user_id: string | null;
  place_id: string | null;
  serial: string | null;
  commissioned_on: string | null;
  warranty_until: string | null;
  facts: { label: string; value: string }[];
  created_at: Date;
};
const ASSET = `asset_id, name, subtype, state, party_id, project_id, unit_id, holder_user_id,
  place_id, serial, to_char(commissioned_on, 'YYYY-MM-DD') as commissioned_on,
  to_char(warranty_until, 'YYYY-MM-DD') as warranty_until, facts, created_at`;
const assetOf = (r: AssetRow): Asset => ({
  assetId: r.asset_id,
  name: r.name,
  subtype: r.subtype,
  state: r.state,
  partyId: r.party_id,
  projectId: r.project_id,
  unitId: r.unit_id,
  holderUserId: r.holder_user_id,
  placeId: r.place_id,
  serial: r.serial,
  commissionedOn: r.commissioned_on,
  warrantyUntil: r.warranty_until,
  facts: r.facts,
  createdAt: r.created_at.toISOString(),
});

export async function findAsset(db: SqlExecutor, id: string): Promise<Asset | null> {
  const { rows } = await db.query<AssetRow>(`select ${ASSET} from assets where asset_id = $1`, [
    id,
  ]);
  return rows[0] ? assetOf(rows[0]) : null;
}

/**
 * An asset is born — by hand, or from a project it was delivered by. Its thread is born with it,
 * held by the person who answers for it, its creator joining it.
 */
export const createAsset = defineCommand({
  name: 'create-asset',
  input: assetInput.extend({ creator: actor }),
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    await checkReferences(db, input);
    const id = newId('ast');
    const holder = input.holderUserId ?? input.creator.userId;
    await db.query(
      `insert into assets (organization_id, asset_id, name, subtype, state, party_id, project_id,
         unit_id, holder_user_id, place_id, serial, commissioned_on, warranty_until, facts, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        organizationId,
        id,
        input.name,
        input.subtype ?? null,
        input.state,
        input.partyId ?? null,
        input.projectId ?? null,
        input.unitId ?? null,
        holder,
        input.placeId ?? null,
        input.serial ?? null,
        input.commissionedOn ?? null,
        input.warrantyUntil ?? null,
        JSON.stringify(input.facts),
        input.creator.userId,
      ],
    );
    const thread = await openThread(db, organizationId, {
      kind: 'object',
      object: { kind: 'asset', id },
      title: input.name,
      holder: { kind: 'person', id: holder },
    });
    for (const member of new Set([holder, input.creator.userId])) {
      await joinThread(db, organizationId, thread.id, { kind: 'person', id: member });
    }
    return { asset: (await findAsset(db, id)) as Asset };
  },
});

export const updateAsset = defineCommand({
  name: 'update-asset',
  input: assetInput
    .omit({ facts: true, state: true })
    .partial()
    .extend({
      assetId,
      state: z.enum(assetStates).optional(),
      facts: z.array(fact).max(20).optional(),
    }),
  reversibility: { reversible: true, inverse: 'update-asset' },
  async handler(input, { db }) {
    if (!(await findAsset(db, input.assetId)))
      throw new ObjectRefusal('not_found', 'No such asset.');
    await checkReferences(db, input);
    const sets: string[] = [];
    const params: unknown[] = [input.assetId];
    const set = (column: string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    set('name', input.name);
    set('subtype', input.subtype);
    set('state', input.state);
    set('party_id', input.partyId);
    set('project_id', input.projectId);
    set('unit_id', input.unitId);
    set('holder_user_id', input.holderUserId);
    set('place_id', input.placeId);
    set('serial', input.serial);
    set('commissioned_on', input.commissionedOn);
    set('warranty_until', input.warrantyUntil);
    set('facts', input.facts === undefined ? undefined : JSON.stringify(input.facts));
    if (sets.length > 0) {
      await db.query(
        `update assets set ${sets.join(', ')}, updated_at = now() where asset_id = $1`,
        params,
      );
    }
    return { asset: (await findAsset(db, input.assetId)) as Asset };
  },
});
