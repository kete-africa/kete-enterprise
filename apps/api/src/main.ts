import { serve } from '@hono/node-server';
import { createApi } from './app.js';
import { env } from './platform/env.js';

serve({ fetch: createApi().fetch, port: env.port, hostname: '0.0.0.0' }, ({ port }) => {
  console.log(`Kete Enterprise API on port ${port}`);
});
