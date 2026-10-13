// The connectors feature's only door: a business tool read through its MCP server (spec 069).
export { connectorRoutes } from './routes.js';
export {
  connectorsMigrationSql,
  readConnected,
  useConnectorFetch,
  type ReadReport,
} from './connectors.js';
