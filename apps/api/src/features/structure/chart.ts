import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { reach, reachesAnything, unitsOfPerson } from '../rights/index.js';
import { readChart } from './infrastructure/structure.tables.js';
import type { Chart } from './structure.record.js';

/**
 * The chart as the person may see it: her reach for « structure:read », and her own units. The
 * screens and the MCP gateway read the same.
 */
export async function chartFor(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'role' | 'userId'>,
  asOf: string,
): Promise<Chart> {
  const chart = await readChart(db, asOf);
  const scope = await reach(db, identity, 'structure:read', asOf);
  if (scope.everywhere) return { asOf, ...chart };
  const visible = new Set([...scope.units, ...(await unitsOfPerson(db, identity, asOf))]);
  const positions = chart.positions.filter((p) => visible.has(p.unitId));
  const positionIds = new Set(positions.map((p) => p.positionId));
  const assignments = chart.assignments.filter((a) => positionIds.has(a.positionId));
  // Whoever draws a part of the organization chooses among all its people; others see those of
  // the positions they see.
  const drawing = reachesAnything(await reach(db, identity, 'structure:write', asOf));
  const assigned = new Set(assignments.map((a) => a.personId));
  return {
    asOf,
    unitTypes: chart.unitTypes,
    units: chart.units.filter((u) => visible.has(u.unitId)),
    positions,
    people: drawing ? chart.people : chart.people.filter((p) => assigned.has(p.personId)),
    assignments,
  };
}
