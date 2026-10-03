// The registry feature's only door: what the rest of the API may use (spec 004).
import './subjects.js';
export {
  registerAgent,
  registerResource,
  RegistryRuleError,
  registerResourceForAgent,
} from './commands.js';
export {
  isPublicIp,
  readIdentityCard,
  useCardReader,
  type CardReader,
} from './infrastructure/identity-card.js';
export {
  listResources,
  registryCircuitsMigrationSql,
  registryMigrationSql,
} from './infrastructure/registry.tables.js';
export { registerInput, riskOf } from './registry.record.js';
export type {
  IdentityCard,
  Promotion,
  Resource,
  ResourceKind,
  Risk,
  Tier,
} from './registry.record.js';
export { flagsOf, registryFor, registryPermissions, registryRoutes } from './routes.js';
