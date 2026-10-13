import { Hono, type Context } from 'hono';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';
import {
  ConnectorError,
  createConnector,
  listConnectors,
  noteFailure,
  readConnector,
  setConnectorStatus,
} from './connectors.js';
import { presets } from './infrastructure/presets.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

function administrator(c: Ctx): void {
  if (!isAdministrator(c.get('identity'))) {
    throw new GestureRefusal(403, 'forbidden', 'Only administrators connect a tool.');
  }
}

const statusOf: Record<ConnectorError['code'], number> = {
  not_found: 404,
  not_tried: 409,
  name_taken: 409,
  secrets_off: 409,
  unreachable: 502,
  no_such_tool: 422,
  not_read_only: 422,
  unreadable: 502,
};

function refuse(error: unknown): never {
  if (error instanceof ConnectorError) {
    throw new GestureRefusal(statusOf[error.code] as 404, error.code, error.message);
  }
  throw error;
}

/** Reads a connector, and keeps why it failed on it when it does. */
async function read(c: Ctx, file: boolean) {
  const { organizationId } = c.get('identity');
  const connectorId = c.req.param('connectorId') ?? '';
  try {
    return await transaction(organizationId, (db) =>
      readConnector(db, organizationId, connectorId, { file }),
    );
  } catch (error) {
    if (error instanceof ConnectorError && error.code !== 'not_found') {
      await transaction(organizationId, (db) => noteFailure(db, connectorId, error.code));
    }
    return refuse(error);
  }
}

/**
 * Connectors, under /v1/connectors (spec 069): an administrator adds one, tries it, connects it.
 * Its credential goes in once and never comes back.
 */
export const connectorRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    administrator(c);
    const { organizationId } = c.get('identity');
    return c.json({
      connectors: await transaction(organizationId, (db) => listConnectors(db)),
      presets,
    });
  })
  .post('/', async (c: Ctx) => {
    administrator(c);
    return c.json(
      { connector: await runGesture(c, createConnector, await bodyOf(c)).catch(refuse) },
      201,
    );
  })
  // « Essayer »: what it would file, and for whom. Nothing is filed.
  .post('/:connectorId/try', async (c: Ctx) => {
    administrator(c);
    return c.json({ report: await read(c, false) });
  })
  // Reads it now, rather than at the worker's next round.
  .post('/:connectorId/read', async (c: Ctx) => {
    administrator(c);
    const { organizationId } = c.get('identity');
    const connected = await transaction(organizationId, async (db) =>
      (await listConnectors(db)).some(
        (connector) =>
          connector.connectorId === c.req.param('connectorId') && connector.status === 'connected',
      ),
    );
    if (!connected) throw new GestureRefusal(409, 'not_connected', 'Connect it first.');
    return c.json({ report: await read(c, true) });
  })
  .post('/:connectorId/status', async (c: Ctx) => {
    administrator(c);
    const body = (await bodyOf(c)) as object | null;
    return c.json(
      await runGesture(c, setConnectorStatus, {
        ...body,
        connectorId: c.req.param('connectorId'),
      }).catch(refuse),
    );
  });
