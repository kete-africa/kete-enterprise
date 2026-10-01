import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Chart } from './structure';

// The registry as the API serves it (spec 004).

export type ResourceKind = 'app' | 'skill' | 'mcp' | 'agent';
export const resourceKinds: ResourceKind[] = ['app', 'skill', 'mcp', 'agent'];
export type Risk = 'unknown' | 'low' | 'medium' | 'high';
export type Tier =
  { kind: 'personal' } | { kind: 'unit'; unitId: string } | { kind: 'organization' };

export interface Resource {
  resourceId: string;
  kind: ResourceKind;
  name: string;
  description: string | null;
  address: string | null;
  ownerUserId: string;
  ownerName: string;
  tier: Tier;
  status: 'active' | 'retired';
  risk: Risk;
  flags: ('no_card' | 'no_owner')[];
}

export interface PendingPromotion {
  promotionId: string;
  resourceId: string;
  target: Tier;
  resource: { name: string; kind: ResourceKind; risk: Risk; ownerName: string } | null;
}

export interface RegistryScreen {
  resources: Resource[];
  toDecide: PendingPromotion[];
  mine: PendingPromotion[];
  reviews: boolean;
  me: string;
  units: Chart['units'];
}

/** The registry in the person's reach, and the units she may share with. */
export const fetchRegistry = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RegistryScreen> => {
    const request = getRequest();
    const [registry, chart, me] = await Promise.all([
      callApi<Omit<RegistryScreen, 'me' | 'units'>>(request, '/v1/registry'),
      callApi<Chart>(request, '/v1/structure'),
      callApi<{ userId: string }>(request, '/v1/me'),
    ]);
    // The API sends the identity card too; the screen keeps what it shows.
    const resources = registry.resources.map((r) => ({
      resourceId: r.resourceId,
      kind: r.kind,
      name: r.name,
      description: r.description,
      address: r.address,
      ownerUserId: r.ownerUserId,
      ownerName: r.ownerName,
      tier: r.tier,
      status: r.status,
      risk: r.risk,
      flags: r.flags,
    }));
    return { ...registry, resources, me: me.userId, units: chart.units };
  },
);

const paths =
  /^\/(resources|resources\/res_[0-9a-f-]+\/(refresh|retire|promotions)|promotions\/prm_[0-9a-f-]+\/decide)$/;

export const changeRegistry = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.test(path)) throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer = await sendGesture(getRequest(), `/v1/registry${data.path}`, data.body, data.key);
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
