import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Chart } from './structure';

// The rights as the API serves them (spec 003).

export interface Reach {
  permission: string;
  everywhere: boolean;
  units: string[];
}

export interface Role {
  roleId: string;
  name: string;
  permissions: string[];
}

export interface Grant {
  grantId: string;
  roleId: string;
  positionId: string | null;
  personId: string | null;
  scopeUnitId: string | null;
  scopeCountry: string | null;
  startsOn: string;
  endsOn: string | null;
}

/** An app's permissions, as its card declares them (spec 022). */
export interface AppPermissions {
  product: string;
  appName: string;
  resourceId: string;
  permissions: {
    /** As a role carries it: `prd_kete_helpdesk#tickets:manage`. */
    key: string;
    name: string;
    label: { fr: string; en: string };
    description?: { fr: string; en: string };
    roles: string[];
  }[];
}

export interface RightsScreen {
  reaches: Reach[];
  /** Null when the person may not manage rights. */
  managed: { roles: Role[]; grants: Grant[]; permissions: string[] } | null;
  /** The organization's apps and the permissions they declare. */
  apps: AppPermissions[];
  chart: Chart;
}

/** Everything the « Droits » screen shows, as the API lets this person see it. */
export const fetchRights = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RightsScreen> => {
    const request = getRequest();
    const [{ reaches }, chart, { permissions, apps }] = await Promise.all([
      callApi<{ reaches: Reach[] }>(request, '/v1/rights/me'),
      callApi<Chart>(request, '/v1/structure'),
      callApi<{ permissions: string[]; apps: AppPermissions[] }>(request, '/v1/rights/permissions'),
    ]);
    const manages = reaches.some((r) => r.permission === 'rights:manage' && r.everywhere);
    const managed = manages
      ? {
          ...(await callApi<{ roles: Role[]; grants: Grant[] }>(request, '/v1/rights')),
          permissions,
        }
      : null;
    return { reaches, managed, apps, chart };
  },
);

/** Whether the person may change the structure somewhere (the « Structure » screen's forms). */
export const fetchMyReaches = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Reach[]> =>
    (await callApi<{ reaches: Reach[] }>(getRequest(), '/v1/rights/me')).reaches,
);

const paths =
  /^\/(roles|grants|roles\/rol_[0-9a-f-]+\/permissions|grants\/grt_[0-9a-f-]+\/revoke)$/;

export const changeRights = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.test(path)) throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer = await sendGesture(getRequest(), `/v1/rights${data.path}`, data.body, data.key);
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
