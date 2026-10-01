import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { covers, reach, reachesAnything, unitsOfPerson, type Reach } from '../rights/index.js';
import {
  addPerson,
  assignPerson,
  closePositionCommand,
  closeUnitCommand,
  createPosition,
  createUnit,
  createUnitType,
  endAssignmentCommand,
  moveUnit,
  StructureRuleError,
} from './commands.js';
import { readChart, unitOfAssignment, unitOfPosition } from './infrastructure/structure.tables.js';
import { day, type Chart } from './structure.record.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 003). */
export const structurePermissions = ['structure:read', 'structure:write'] as const;

/** Where the person may change the structure. */
function writeReach(c: Ctx): Promise<Reach> {
  const identity = c.get('identity');
  return transaction(identity.organizationId, (db) => reach(db, identity, 'structure:write'));
}

/**
 * Runs a structure command if the person may change the structure on every unit it touches:
 * `units` returns those units (`null` stands for the organization as a whole).
 */
async function change<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
  units: (db: SqlExecutor) => Promise<(string | null)[]> | (string | null)[],
): Promise<Response> {
  const scope = await writeReach(c);
  const touched = await transaction(c.get('identity').organizationId, async (db) => units(db));
  if (!touched.every((unit) => covers(scope, unit))) {
    throw new GestureRefusal(
      403,
      'forbidden',
      'This needs the « structure:write » permission on that part of the organization.',
    );
  }
  try {
    return c.json(await runGesture(c, definition, input), 201);
  } catch (error) {
    if (error instanceof StructureRuleError) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 409, error.code, error.message);
    }
    throw error;
  }
}

const field = (input: unknown, name: string): string | null => {
  const value = (input as Record<string, unknown> | null)?.[name];
  return typeof value === 'string' ? value : null;
};

/** The chart as the person may see it: her reach for « structure:read », and her own units. */
async function visibleChart(c: Ctx, asOf: string): Promise<Chart> {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) => {
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
  });
}

/** The structure's routes, under /v1/structure (spec 002, under the rights of spec 003). */
export const structureRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const asOf = c.req.query('asOf') ?? new Date().toISOString().slice(0, 10);
    if (!day.safeParse(asOf).success) {
      throw new GestureRefusal(422, 'invalid_date', 'asOf is written YYYY-MM-DD.');
    }
    return c.json(await visibleChart(c, asOf));
  })
  // Unit types are the organization's vocabulary: changing it needs the whole organization.
  .post('/unit-types', async (c) => change(c, createUnitType, await bodyOf(c), () => [null]))
  .post('/units', async (c) => {
    const input = await bodyOf(c);
    return change(c, createUnit, input, () => [field(input, 'parentId')]);
  })
  .post('/units/:unitId/move', async (c) => {
    const input = { ...(await body(c)), unitId: c.req.param('unitId') };
    return change(c, moveUnit, input, () => [input.unitId, field(input, 'parentId')]);
  })
  .post('/units/:unitId/close', async (c) => {
    const input = { ...(await body(c)), unitId: c.req.param('unitId') };
    return change(c, closeUnitCommand, input, () => [input.unitId]);
  })
  .post('/positions', async (c) => {
    const input = await bodyOf(c);
    return change(c, createPosition, input, () => [field(input, 'unitId')]);
  })
  .post('/positions/:positionId/close', async (c) => {
    const input = { ...(await body(c)), positionId: c.req.param('positionId') };
    return change(c, closePositionCommand, input, async (db) => [
      await unitOfPosition(db, input.positionId),
    ]);
  })
  // People belong to the organization: anyone who draws a part of it may add them.
  .post('/people', async (c) => {
    const scope = await writeReach(c);
    const input = await bodyOf(c);
    return change(c, addPerson, input, () => (reachesAnything(scope) ? [] : [null]));
  })
  .post('/assignments', async (c) => {
    const input = await bodyOf(c);
    const positionId = field(input, 'positionId');
    return change(c, assignPerson, input, async (db) => [
      positionId ? await unitOfPosition(db, positionId) : null,
    ]);
  })
  .post('/assignments/:assignmentId/end', async (c) => {
    const input = { ...(await body(c)), assignmentId: c.req.param('assignmentId') };
    return change(c, endAssignmentCommand, input, async (db) => [
      await unitOfAssignment(db, input.assignmentId),
    ]);
  });

async function body(c: Ctx): Promise<Record<string, unknown>> {
  const value = await bodyOf(c);
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
