// The connections' only door (spec 105; kete-core ADR 0019 and spec 147).
export {
  ConnectionRefusal,
  connectionsMigrationSql,
  connectionsOf,
  openWebhook,
  setConnectionGrants,
  webhookOf,
  webhookSecret,
  type ConnectionView,
  type Health,
} from './connections.js';
export { connectionsRoutes, connectionWebhook } from './routes.js';
