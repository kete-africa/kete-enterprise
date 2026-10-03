import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { listResources } from '../registry/index.js';
import { reach } from '../rights/index.js';

// The apps' permissions (spec 022, kete-core spec 049): each app declares them in its card, with
// their words; Kete Enterprise lets an administrator put them in roles, granted to positions on a
// scope, like its own. The app asks what a person holds, with her token.

export interface AppPermission {
  /** As a role carries it: `prd_kete_helpdesk#tickets:manage`. */
  key: string;
  /** As the app checks it: `tickets:manage`. */
  name: string;
  label: { fr: string; en: string };
  description?: { fr: string; en: string };
  /** The Compte Kete roles that hold it while the app's rights are not managed here. */
  roles: string[];
}

export interface AppPermissions {
  product: string;
  appName: string;
  resourceId: string;
  permissions: AppPermission[];
}

export const appKey = (product: string, name: string) => `${product}#${name}`;

/** The permissions of the organization's active apps, read from their cards: one entry per app. */
export async function appPermissions(db: SqlExecutor): Promise<AppPermissions[]> {
  const seen = new Set<string>();
  const apps: AppPermissions[] = [];
  for (const r of await listResources(db)) {
    const card = r.card;
    if (r.kind !== 'app' || r.status !== 'active' || !card?.permissions?.length) continue;
    if (seen.has(card.product)) continue;
    seen.add(card.product);
    apps.push({
      product: card.product,
      appName: r.name,
      resourceId: r.resourceId,
      permissions: card.permissions.map((p) => ({
        key: appKey(card.product, p.name),
        name: p.name,
        label: p.label,
        ...(p.description ? { description: p.description } : {}),
        roles: p.roles,
      })),
    });
  }
  return apps;
}

/** Every app permission a role may carry in this organization. */
export async function appPermissionKeys(db: SqlExecutor): Promise<string[]> {
  return (await appPermissions(db)).flatMap((a) => a.permissions.map((p) => p.key));
}

export interface AppGrants {
  /** Once a role here carries one of the app's permissions: its grants decide, not its defaults. */
  managed: boolean;
  permissions: { permission: string; everywhere: boolean; units: string[] }[];
}

/** What a person holds for an app, and where — what the app reads with her token. */
export async function appGrants(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'role' | 'userId'>,
  product: string,
): Promise<AppGrants> {
  const app = (await appPermissions(db)).find((a) => a.product === product);
  if (!app) return { managed: false, permissions: [] };
  const { rows } = await db.query<{ managed: boolean }>(
    `select exists (
       select 1 from roles r, unnest(r.permissions) p where starts_with(p, $1)
     ) as managed`,
    [`${product}#`],
  );
  const permissions: AppGrants['permissions'] = [];
  for (const p of app.permissions) {
    const scope = await reach(db, identity, p.key);
    if (scope.everywhere || scope.units.size > 0) {
      permissions.push({
        permission: p.name,
        everywhere: scope.everywhere,
        units: [...scope.units],
      });
    }
  }
  return { managed: rows[0]?.managed ?? false, permissions };
}
