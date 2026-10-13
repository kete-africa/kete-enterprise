import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { knownWatches } from '../agents/index.js';
import { listConnectors } from '../connectors/index.js';
import { gatewayCapabilities } from '../gateway/index.js';
import { readModules, type ModuleKey } from '../organization/index.js';
import { registryFor } from '../registry/index.js';
import { isAdministrator, reach, reachesAnything } from '../rights/index.js';

// « Apps » (spec 070, doctrine D-042): what sits behind the center, and what the center receives
// from each. The center has three places — Décider, Demander, Déléguer; a business tool is an
// app. Three kinds stand here: the organization's own tools read by a connector (spec 069), the
// team's apps of the registry, and the business tools delivered with the center — its packs.
//
// A pack is known to the center through its descriptor alone: where it opens, the permissions
// that open it, and what it gives the center — the capabilities agents may call, the watch an
// agent may run. That is the shape of the app contract; the packs do not run apart yet.

interface PackDescriptor {
  key: Extract<ModuleKey, 'surveys' | 'performance' | 'meetings' | 'compliance'>;
  href: string;
  /** The prefix of its permissions: `performance:` opens Performance. */
  permissions: string;
}

/** The business tools delivered with the center. */
export const packs: readonly PackDescriptor[] = [
  { key: 'surveys', href: '/enquetes', permissions: 'surveys:' },
  { key: 'performance', href: '/performance', permissions: 'performance:' },
  { key: 'meetings', href: '/instances', permissions: 'meetings:' },
  { key: 'compliance', href: '/conformite', permissions: 'compliance:' },
];

export interface AppEntry {
  kind: 'pack' | 'app' | 'connector';
  /** A pack's key — its name is the screens' — or the name of an app or a connector. */
  key: string;
  name: string | null;
  /** Where it opens: a page of the space, the app's own address; none for a connector. */
  href: string | null;
  external: boolean;
  /** What the center receives from it. */
  receives: {
    /** What waits for her in her « Décider », filed by it. */
    waiting: number;
    /** The capabilities an agent may call there, within her rights. */
    tools: number;
    /** Whether an agent may watch it and signal what goes wrong. */
    watch: boolean;
    /** A connector: what it reads, in her words. */
    reads: string | null;
  };
}

/** How many open tasks each source filed for her. */
async function waitingBySource(db: SqlExecutor, userId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ source: string; n: string }>(
    `select source, count(*) as n from app_tasks
      where user_id = $1 and status = 'open' group by source`,
    [userId],
  );
  return new Map(rows.map((row) => [row.source, Number(row.n)]));
}

/**
 * What stands behind the center for a person: the packs switched on that her rights open, the
 * team's apps the registry shows her, the connected connectors — each with what it gives.
 */
export async function appsFor(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
  permissions: readonly string[],
): Promise<AppEntry[]> {
  const waiting = await waitingBySource(db, identity.userId);
  const modules = await readModules(db);
  const watches = new Set(knownWatches());
  const entries: AppEntry[] = [];
  for (const pack of packs) {
    if (!modules[pack.key]) continue;
    const own = permissions.filter((permission) => permission.startsWith(pack.permissions));
    let opens = isAdministrator(identity);
    for (const permission of own) {
      if (opens) break;
      opens = reachesAnything(await reach(db, identity, permission));
    }
    if (!opens) continue;
    entries.push({
      kind: 'pack',
      key: pack.key,
      name: null,
      href: pack.href,
      external: false,
      receives: {
        waiting: 0,
        tools: gatewayCapabilities.filter((capability) =>
          capability.permission.startsWith(pack.permissions),
        ).length,
        watch: watches.has(pack.key),
        reads: null,
      },
    });
  }
  const { resources } = await registryFor(db, identity);
  for (const resource of resources) {
    if (resource.kind !== 'app' || resource.status !== 'active') continue;
    entries.push({
      kind: 'app',
      key: resource.resourceId,
      name: resource.name,
      href: resource.address ?? null,
      external: true,
      receives: {
        waiting: waiting.get(resource.name) ?? 0,
        tools: 0,
        watch: false,
        reads: null,
      },
    });
  }
  for (const connector of await listConnectors(db)) {
    if (connector.status !== 'connected') continue;
    entries.push({
      kind: 'connector',
      key: connector.connectorId,
      name: connector.name,
      href: null,
      external: false,
      receives: {
        waiting: waiting.get(connector.name) ?? 0,
        tools: 0,
        watch: false,
        reads: connector.reading.label,
      },
    });
  }
  return entries;
}
