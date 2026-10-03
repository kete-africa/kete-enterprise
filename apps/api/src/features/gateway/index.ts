// The gateway feature's only door: what the rest of the API may use (spec 006).
export { gatewayCapabilities } from './capabilities.js';
export { gatewayAppendOnlySql, gatewayMigrationSql } from './infrastructure/gateway.tables.js';
export {
  decideDraft,
  DRAFT_BUDGET,
  draftsFor,
  gatewayResourceMetadata,
  handleGateway,
  toolsForPerson,
} from './mcp.js';
export { gatewayRoutes } from './routes.js';
