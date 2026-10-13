import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { findProject, projectsFor, type Project } from '../projects/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import {
  dropFact,
  factsOf,
  moneyFactInput,
  moneyOf,
  MoneyRefusal,
  organizationMoney,
  sayFact,
} from './money.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 076). */
export const moneyPermissions = ['money:record', 'money:read'] as const;

async function holds(c: Ctx, db: SqlExecutor, permission: (typeof moneyPermissions)[number]) {
  return reachesAnything(await reach(db, c.get('identity'), permission));
}

const saidInput = z.object({ source: z.string().trim().min(1).max(80), fact: moneyFactInput });
const droppedInput = z.object({
  source: z.string().trim().min(1).max(80),
  key: z.string().min(1).max(200),
});

/**
 * A project's money is read by its lead, and by who reads the organization's money. Its team
 * sees the project, not its margin. Outside, the project does not exist.
 */
async function readableProject(c: Ctx, db: SqlExecutor, projectId: string): Promise<Project> {
  const project = await findProject(db, projectId);
  const { userId } = c.get('identity');
  const reads = await holds(c, db, 'money:read');
  const inTeam = project?.team.some((member) => member.userId === userId) ?? false;
  if (!project || (!inTeam && !reads)) {
    throw new GestureRefusal(404, 'not_found', 'No such project of hers.');
  }
  if (project.lead.userId !== userId && !reads) {
    throw new GestureRefusal(403, 'forbidden', 'Its money is its lead’s to read.');
  }
  return project;
}

/**
 * Money, under /v1/money (spec 076): the apps say their facts here, in the contract's shape, with
 * the token of a person who records money; the center answers what a project received, committed
 * and spent.
 */
export const moneyRoutes = new Hono<{ Variables: IdentityVariables }>()
  .post('/facts', async (c: Ctx) => {
    const parsed = saidInput.safeParse(await bodyOf(c));
    if (!parsed.success) {
      throw new GestureRefusal(422, 'invalid_input', 'A source, and a fact of money.');
    }
    const { organizationId, userId } = c.get('identity');
    await transaction(organizationId, async (db) => {
      if (!(await holds(c, db, 'money:record'))) {
        throw new GestureRefusal(403, 'forbidden', 'Money is not hers to record.');
      }
      await sayFact(db, organizationId, { ...parsed.data, by: userId });
    }).catch((error: unknown) => {
      if (error instanceof MoneyRefusal) {
        throw new GestureRefusal(
          error.code === 'currency_mismatch' ? 409 : 404,
          error.code,
          error.code,
        );
      }
      throw error;
    });
    return c.json({ kept: true }, 201);
  })
  .post('/facts/drop', async (c: Ctx) => {
    const parsed = droppedInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A source, a key.');
    const { organizationId } = c.get('identity');
    const dropped = await transaction(organizationId, async (db) => {
      if (!(await holds(c, db, 'money:record'))) {
        throw new GestureRefusal(403, 'forbidden', 'Money is not hers to record.');
      }
      return dropFact(db, parsed.data);
    });
    return c.json({ dropped });
  })
  // The organization's money as the facts tell it, and each project's — for who reads it all.
  .get('/', async (c: Ctx) => {
    const { organizationId, userId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => {
        if (!(await holds(c, db, 'money:read'))) {
          throw new GestureRefusal(
            403,
            'forbidden',
            'The organization’s money is not hers to read.',
          );
        }
        const projects = await projectsFor(db, userId, { all: true });
        const currency = c.req.query('currency') ?? projects[0]?.currency ?? 'XOF';
        const open = projects.filter((project) => project.currency === currency);
        return {
          organization: await organizationMoney(db, currency, projects),
          projects: await Promise.all(
            open.map(async (project) => ({
              projectId: project.projectId,
              name: project.name,
              status: project.status,
              sold: project.sold,
              budget: project.budget,
              money: await moneyOf(db, project),
            })),
          ),
        };
      }),
    );
  })
  .get('/projects/:projectId', async (c: Ctx) => {
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => {
        const project = await readableProject(c, db, c.req.param('projectId') ?? '');
        return { money: await moneyOf(db, project), facts: await factsOf(db, project.projectId) };
      }),
    );
  });
