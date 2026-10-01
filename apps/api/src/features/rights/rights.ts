import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { ownUnits, ownUnitsAndAbove, reachOf } from './infrastructure/rights.tables.js';
import type { Reach } from './rights.record.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The organization's owners and admins at the Compte Kete hold every permission everywhere: they
 * are the ones who grant the others (spec 003).
 */
export function isAdministrator(identity: Pick<KeteIdentity, 'role'>): boolean {
  return identity.role === 'owner' || identity.role === 'admin';
}

/** Where the person holds `permission` at a date. */
export function reach(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'role' | 'userId'>,
  permission: string,
  asOf: string = today(),
): Promise<Reach> {
  if (isAdministrator(identity)) return Promise.resolve({ everywhere: true, units: new Set() });
  return reachOf(db, identity.userId, permission, asOf);
}

/** Whether a reach covers a unit; `null` stands for the organization as a whole. */
export function covers(scope: Reach, unitId: string | null): boolean {
  return scope.everywhere || (unitId !== null && scope.units.has(unitId));
}

/** Whether a reach covers anything at all. */
export function reachesAnything(scope: Reach): boolean {
  return scope.everywhere || scope.units.size > 0;
}

/** The units where the person holds a position: what anyone sees of the structure. */
export function unitsOfPerson(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId'>,
  asOf: string = today(),
): Promise<Set<string>> {
  return ownUnits(db, identity.userId, asOf);
}

/** The units where the person holds a position, and every unit above them. */
export function unitsOfPersonAndAbove(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId'>,
  asOf: string = today(),
): Promise<Set<string>> {
  return ownUnitsAndAbove(db, identity.userId, asOf);
}
