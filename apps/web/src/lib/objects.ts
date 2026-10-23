import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// The objects at the center (spec 100; doctrine D-062, R1, R2): the index of every object she may
// read — projects, third parties, units, places, assets, the apps' objects — and two references of
// the center born here: places, and assets (what the organization installs or owns and keeps).

export interface IndexedObject {
  kind: string;
  id: string;
  product: string;
  title: string;
  state: string | null;
  stateLabel: string | null;
  stateTone: 'neutral' | 'ok' | 'verify' | 'error' | 'info' | null;
  closed: boolean;
  projectId: string | null;
  partyId: string | null;
  unitId: string | null;
  personId: string | null;
  href: string | null;
  updatedAt: string;
}

export interface ObjectLink {
  relation: string;
  label: string;
  direction: 'out' | 'in';
  object: IndexedObject;
}

export interface ObjectCard {
  object: IndexedObject;
  links: ObjectLink[];
  threadId: string | null;
  holdings: { id: string; what: string; holder: string; state: string; due: string | null }[];
}

export const assetStates = [
  'in_service',
  'alert',
  'maintenance',
  'out_of_service',
  'retired',
] as const;
export type AssetState = (typeof assetStates)[number];

export interface Asset {
  assetId: string;
  name: string;
  subtype: string | null;
  state: AssetState;
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

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const idOf = (prefix: string, value: unknown) => {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`).test(value)) {
    throw new Error('Unknown.');
  }
  return value;
};

/** What she may read of the index, by words, kind, unit or state. */
export const fetchObjects = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const key of ['q', 'kind', 'unit', 'project', 'party', 'state'] as const) {
      const value = text(v[key], 120);
      if (value) params.set(key, value);
    }
    if (v.closed === true) params.set('closed', 'true');
    params.set('limit', '200');
    return { search: params.toString() };
  })
  .handler(({ data }) =>
    callApi<{ objects: IndexedObject[]; titles: Record<string, string> }>(
      getRequest(),
      `/v1/objects?${data.search}`,
    ).catch(() => ({ objects: [] as IndexedObject[], titles: {} as Record<string, string> })),
  );

/** Every kind of the organization, with its states' words. */
export const fetchKinds = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{
    kinds: {
      kind: string;
      product: string;
      label: { fr: string; en: string; fr_plural?: string };
      states: { id: string; label: { fr: string; en: string } }[];
    }[];
  }>(getRequest(), '/v1/objects/kinds')
    .then((answer) => answer.kinds)
    .catch(() => []),
);

export const fetchAsset = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    assetId: idOf('ast', (input as { assetId?: unknown })?.assetId),
  }))
  .handler(({ data }) =>
    callApi<ObjectCard & { asset: Asset; changeable: boolean }>(
      getRequest(),
      `/v1/assets/${data.assetId}`,
    ).catch(() => null),
  );

/** What happened to an object, the latest first (spec 101): its births, its states, the apps' facts. */
export interface ObjectEvent {
  eventId: string;
  source: 'app' | 'index';
  type: string;
  label: string;
  app: string | null;
  data: { from?: string; to?: string; state?: string };
  occurredAt: string;
}

export const fetchObjectEvents = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { kind?: unknown; id?: unknown };
    if (typeof v.kind !== 'string' || !/^[a-z][a-z0-9_]{1,40}$/.test(v.kind)) {
      throw new Error('Unknown.');
    }
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v.id)) {
      throw new Error('Unknown.');
    }
    return { kind: v.kind, id: v.id };
  })
  .handler(({ data }) =>
    callApi<{ events: ObjectEvent[] }>(
      getRequest(),
      `/v1/objects/${data.kind}/${encodeURIComponent(data.id)}/events`,
    )
      .then((answer) => answer.events)
      .catch(() => [] as ObjectEvent[]),
  );

export const fetchPlace = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    placeId: idOf('plc', (input as { placeId?: unknown })?.placeId),
  }))
  .handler(({ data }) =>
    callApi<ObjectCard & { place: Place; changeable: boolean }>(
      getRequest(),
      `/v1/places/${data.placeId}`,
    ).catch(() => null),
  );

/** An asset is declared: a name is enough; the rest when she knows it. */
export const createAsset = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const subtype = text(v.subtype, 60);
    const unitId = text(v.unitId, 80);
    const projectId = text(v.projectId, 80);
    return {
      name: text(v.name, 160),
      ...(subtype ? { subtype } : {}),
      ...(/^unt_[0-9a-f-]{8,64}$/.test(unitId) ? { unitId } : {}),
      ...(/^prj_[0-9a-f-]{8,64}$/.test(projectId) ? { projectId } : {}),
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ asset: Asset }>(
      getRequest(),
      '/v1/assets',
      data,
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, assetId: answer.data.asset.assetId, error: null }
      : { ok: false as const, assetId: null, error: answer.error };
  });

/** Who answers for it, or who manages the objects, changes its state. */
export const setAssetState = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { assetId?: unknown; state?: unknown };
    if (!assetStates.includes(v.state as AssetState)) throw new Error('Unknown.');
    return { assetId: idOf('ast', v.assetId), state: v.state as AssetState };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/assets/${data.assetId}`,
      { state: data.state },
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });
