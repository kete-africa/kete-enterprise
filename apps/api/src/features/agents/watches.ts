import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { inboxFor } from '../decisions/index.js';
import { registryFor } from '../registry/index.js';
import type { Finding } from './agents.record.js';

/**
 * What an agent watches: it reads what its person may see, narrowed to the agent's scope, and says
 * what is wrong. A watch never changes anything (level 1).
 */
export type Watch = (
  db: SqlExecutor,
  person: Pick<KeteIdentity, 'role' | 'userId'>,
  scope: ReadonlySet<string> | null,
) => Promise<Finding[]>;

const watches = new Map<string, { watch: Watch; permission: string | null }>();

/**
 * A feature plugs a watch into the agents; an agent runs it only if its job description lists the
 * permission it needs (none for what concerns its person alone).
 */
export function registerWatch(name: string, permission: string | null, watch: Watch): void {
  watches.set(name, { watch, permission });
}

export function knownWatches(): string[] {
  return [...watches.keys()].sort();
}

export function watchNamed(name: string) {
  return watches.get(name) ?? null;
}

const inScope = (scope: ReadonlySet<string> | null, unitId: string | null) =>
  scope === null || (unitId !== null && scope.has(unitId));

// The registry: apps and MCP servers without an identity card, or whose card names no owner.
registerWatch('registry', 'registry:read', async (db, person, scope) => {
  const { resources } = await registryFor(db, person);
  return resources
    .filter((r) => r.status === 'active' && r.flags.length > 0)
    .filter((r) => inScope(scope, r.tier.kind === 'unit' ? r.tier.unitId : null))
    .flatMap((r) =>
      r.flags.map((flag) => ({
        key: `registry.${flag}:${r.resourceId}`,
        kind: `registry.${flag}`,
        subject: r.name,
        unitId: r.tier.kind === 'unit' ? r.tier.unitId : null,
        details: { resourceId: r.resourceId, kind: r.kind, owner: r.ownerName },
      })),
    );
});

// The decisions: steps waiting for the person longer than their circuit allows.
registerWatch('decisions', null, async (db, person, scope) => {
  const { toDecide } = await inboxFor(db, person);
  return toDecide
    .filter((r) => r.overdue && inScope(scope, r.unitId))
    .map((r) => ({
      key: `decisions.overdue:${r.requestId}:${r.currentStep ?? 0}`,
      kind: 'decisions.overdue',
      subject: r.title,
      unitId: r.unitId,
      details: { requestId: r.requestId, subject: r.subject, step: r.currentStep },
    }));
});
