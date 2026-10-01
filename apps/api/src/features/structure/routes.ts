import type { CommandDefinition } from '@kete/commands';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
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
import { readChart } from './infrastructure/structure.tables.js';
import { canChangeStructure } from './policies.js';
import { day, type Chart } from './structure.record.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** Runs a structure command, if the person may change the structure. */
async function change<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Response> {
  if (!canChangeStructure(c.get('identity'))) {
    throw new GestureRefusal(403, 'forbidden', 'Only an owner or an admin changes the structure.');
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

/** The structure's routes, under /v1/structure (spec 002). */
export const structureRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const asOf = c.req.query('asOf') ?? new Date().toISOString().slice(0, 10);
    if (!day.safeParse(asOf).success) {
      throw new GestureRefusal(422, 'invalid_date', 'asOf is written YYYY-MM-DD.');
    }
    const chart = await transaction(c.get('identity').organizationId, (db) => readChart(db, asOf));
    return c.json({ asOf, ...chart } satisfies Chart);
  })
  .post('/unit-types', async (c) => change(c, createUnitType, await bodyOf(c)))
  .post('/units', async (c) => change(c, createUnit, await bodyOf(c)))
  .post('/units/:unitId/move', async (c) =>
    change(c, moveUnit, { ...(await body(c)), unitId: c.req.param('unitId') }),
  )
  .post('/units/:unitId/close', async (c) =>
    change(c, closeUnitCommand, { ...(await body(c)), unitId: c.req.param('unitId') }),
  )
  .post('/positions', async (c) => change(c, createPosition, await bodyOf(c)))
  .post('/positions/:positionId/close', async (c) =>
    change(c, closePositionCommand, { ...(await body(c)), positionId: c.req.param('positionId') }),
  )
  .post('/people', async (c) => change(c, addPerson, await bodyOf(c)))
  .post('/assignments', async (c) => change(c, assignPerson, await bodyOf(c)))
  .post('/assignments/:assignmentId/end', async (c) =>
    change(c, endAssignmentCommand, {
      ...(await body(c)),
      assignmentId: c.req.param('assignmentId'),
    }),
  );

async function body(c: Ctx): Promise<Record<string, unknown>> {
  const value = await bodyOf(c);
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
