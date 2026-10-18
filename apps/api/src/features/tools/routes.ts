import { Hono, type Context } from 'hono';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import { importTools, listToolSets, setToolSetStatus, ToolSetError } from './tools.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

function administrator(c: Ctx): void {
  if (!isAdministrator(c.get('identity'))) {
    throw new GestureRefusal(403, 'forbidden', 'Only administrators import tools.');
  }
}

const statusOf: Record<ToolSetError['code'], 404 | 409 | 422> = {
  not_found: 404,
  prefix_taken: 409,
  tool_name_taken: 409,
  secrets_off: 409,
  not_public: 422,
  unreachable: 422,
  invalid_description: 422,
  no_tools: 422,
};

function refuse(error: unknown): never {
  if (error instanceof ToolSetError) {
    throw new GestureRefusal(statusOf[error.code], error.code, error.message);
  }
  throw error;
}

/**
 * Imported tools, under /v1/tools (spec 093): an administrator imports a set — an OpenAPI
 * description or a remote MCP server — reads what it holds, turns it off. Its key goes in once
 * and never comes back.
 */
export const toolsRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    administrator(c);
    const { organizationId } = c.get('identity');
    return c.json({ sets: await transaction(organizationId, (db) => listToolSets(db)) });
  })
  .post('/', async (c: Ctx) => {
    administrator(c);
    return c.json({ set: await runGesture(c, importTools, await bodyOf(c)).catch(refuse) }, 201);
  })
  .post('/:setId/status', async (c: Ctx) => {
    administrator(c);
    const body = (await bodyOf(c)) as object | null;
    return c.json(
      await runGesture(c, setToolSetStatus, { ...body, setId: c.req.param('setId') }).catch(refuse),
    );
  });
