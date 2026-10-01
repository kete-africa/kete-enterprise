import type { KeteIdentity } from '@kete/auth';
import { AsyncLocalStorage } from 'node:async_hooks';

export type Acting = KeteIdentity & { organizationId: string };

const current = new AsyncLocalStorage<Acting>();

/** Runs `work` for this person: an agent calling through the gateway acts within her rights. */
export function asPerson<T>(identity: Acting, work: () => T): T {
  return current.run(identity, work);
}

/** The person an MCP call acts for, or null outside one. */
export function actingPerson(): Acting | null {
  return current.getStore() ?? null;
}
