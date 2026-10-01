// The gateway feature's only door: what the rest of the API may use (spec 006).
export { gatewayCapabilities } from './capabilities.js';
export { gatewayMigrationSql } from './infrastructure/gateway.tables.js';
export { gatewayResourceMetadata, handleGateway } from './mcp.js';
export { gatewayRoutes } from './routes.js';
