// The gateway feature's only door: what the rest of the API may use (spec 006).
export { gatewayCapabilities } from './capabilities.js';
export { appToolsFor, useAppFetch } from './federation.js';
export { viewRoutes, viewSandbox } from './views.js';
export { gatewayAppendOnlySql, gatewayMigrationSql } from './infrastructure/gateway.tables.js';
export {
  decideDraft,
  DRAFT_BUDGET,
  draftsFor,
  preparedDraftCount,
  gatewayResourceMetadata,
  handleGateway,
  toolPermissions,
  toolsForAgent,
  toolsForPerson,
} from './mcp.js';
export { gatewayRoutes } from './routes.js';
