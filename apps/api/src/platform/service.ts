import { outboxBacklog, parseManifest, type HealthOptions, type Manifest } from '@kete/sdk';
import app from '../../kete.json' with { type: 'json' };
import { getPool } from './db.js';
import { env } from './env.js';

export const VERSION = app.version;

/** Who Kete Enterprise is, with its identity card (doctrine D-040), at /.well-known/kete. */
export function manifest(): Manifest {
  return parseManifest({
    product: app.product,
    name: app.name,
    version: app.version,
    environment: env.environment,
    events: app.events,
    governance: app.governance,
  });
}

export const health: HealthOptions = {
  version: VERSION,
  dependencies: [{ name: 'database', probe: () => getPool().query('select 1') }],
  backlog: () => outboxBacklog(getPool()),
};
