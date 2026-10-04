import { serve } from '@hono/node-server';
import { observeModels } from '@kete/ai';
import { createApi } from './app.js';
import { env } from './platform/env.js';
import { startWorker } from './worker.js';

// One image, two roles (doctrine D-029): `main.ts worker` runs the worker alone; otherwise the API,
// and the worker beside it when KETE_WORKER_IN_PROCESS is "true" (a small instance, one container).
const role = process.argv[2] === 'worker' ? 'worker' : 'api';

// Every model call traced, to Langfuse when configured, without what people wrote (spec 037).
observeModels();

if (role === 'worker' || process.env.KETE_WORKER_IN_PROCESS === 'true') await startWorker();
if (role === 'api') {
  serve({ fetch: createApi().fetch, port: env.port, hostname: '0.0.0.0' }, ({ port }) => {
    console.log(`Kete Enterprise API on port ${port}`);
  });
}
