import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { colleagueOf, RequestRefusal } from '../requests/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import {
  createProject,
  findProject,
  ProjectError,
  projectIdsOf,
  projectsFor,
  setPost,
  setTeam,
  updateProject,
  type Project,
} from './projects.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 074). */
export const projectsPermissions = ['projects:read', 'projects:manage'] as const;

async function holds(c: Ctx, db: SqlExecutor, permission: (typeof projectsPermissions)[number]) {
  return reachesAnything(await reach(db, c.get('identity'), permission));
}

/** Whether she reads every project, not only those she belongs to. */
async function readsAll(c: Ctx, db: SqlExecutor): Promise<boolean> {
  return (await holds(c, db, 'projects:read')) || (await holds(c, db, 'projects:manage'));
}

/** The project, if it is hers to read: she belongs to it, or reads them all. */
async function readable(c: Ctx, db: SqlExecutor, projectId: string): Promise<Project> {
  const project = await findProject(db, projectId);
  const mine = project?.team.some((member) => member.userId === c.get('identity').userId);
  // Unknown and not hers answer alike: a project's existence is not said to who is outside it.
  if (!project || (!mine && !(await readsAll(c, db)))) {
    throw new GestureRefusal(404, 'not_found', 'No such project of hers.');
  }
  return project;
}

/** The project, if it is hers to change: she leads it, or manages projects. */
async function changeable(c: Ctx, projectId: string): Promise<Project> {
  const { organizationId, userId } = c.get('identity');
  return transaction(organizationId, async (db) => {
    const project = await readable(c, db, projectId);
    if (project.lead.userId !== userId && !(await holds(c, db, 'projects:manage'))) {
      throw new GestureRefusal(403, 'forbidden', 'Its lead, or who manages projects.');
    }
    return project;
  });
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof ProjectError) {
      const status = error.code === 'not_found' || error.code === 'unknown_party' ? 404 : 409;
      // « closed » already names a closed position (spec 002): a project says its own.
      const code = error.code === 'closed' ? 'project_closed' : error.code;
      throw new GestureRefusal(status, code, error.message);
    }
    throw error;
  }
}

/**
 * Projects, under /v1/projects (spec 074): the center's reference of what the organization works
 * on. The screens and the apps — with a person's token — read here the projects she belongs to;
 * an app opens one here from its own document.
 */
export const projectsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    const { organizationId, userId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        projects: await projectsFor(db, userId, { all: await readsAll(c, db) }),
        manages: await holds(c, db, 'projects:manage'),
      })),
    );
  })
  // The identifiers of the projects she belongs to: what an app filters her view by.
  .get('/mine', async (c: Ctx) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({
      projectIds: [...(await transaction(organizationId, (db) => projectIdsOf(db, userId)))],
    });
  })
  .post('/', async (c: Ctx) => {
    const identity = c.get('identity');
    if (!(await transaction(identity.organizationId, (db) => holds(c, db, 'projects:manage')))) {
      throw new GestureRefusal(403, 'forbidden', 'Projects are not hers to open.');
    }
    const body = (await bodyOf(c)) as object | null;
    const made = await run(c, createProject, {
      ...body,
      creator: { userId: identity.userId, name: identity.name || identity.userId },
    });
    return c.json(made, made.created ? 201 : 200);
  })
  .get('/:projectId', async (c: Ctx) => {
    const { organizationId } = c.get('identity');
    return c.json({
      project: await transaction(organizationId, (db) =>
        readable(c, db, c.req.param('projectId') ?? ''),
      ),
    });
  })
  .post('/:projectId', async (c: Ctx) => {
    const project = await changeable(c, c.req.param('projectId') ?? '');
    const body = (await bodyOf(c)) as object | null;
    return c.json(await run(c, updateProject, { ...body, projectId: project.projectId }));
  })
  .post('/:projectId/posts', async (c: Ctx) => {
    const project = await changeable(c, c.req.param('projectId') ?? '');
    const body = (await bodyOf(c)) as object | null;
    return c.json(await run(c, setPost, { ...body, projectId: project.projectId }));
  })
  // A colleague joins the team, or leaves it: named as the directory shows her.
  .post('/:projectId/team', async (c: Ctx) => {
    const project = await changeable(c, c.req.param('projectId') ?? '');
    const body = (await bodyOf(c)) as { colleague?: unknown; on?: unknown } | null;
    if (typeof body?.colleague !== 'string' || body.colleague.trim().length < 2) {
      throw new GestureRefusal(422, 'invalid_input', 'A colleague.');
    }
    const identity = c.get('identity');
    const colleague = await transaction(identity.organizationId, (db) =>
      colleagueOf(db, identity, String(body.colleague)),
    ).catch((error: unknown) => {
      if (error instanceof RequestRefusal) {
        throw new GestureRefusal(error.reason === 'not_found' ? 404 : 422, error.reason, 'Who?');
      }
      throw error;
    });
    return c.json(
      await run(c, setTeam, {
        projectId: project.projectId,
        member: colleague,
        on: body.on !== false,
      }),
    );
  });
