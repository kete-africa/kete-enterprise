// The registry feature's only door: what the rest of the API may use (spec 004).
import './subjects.js';
export { RegistryRuleError } from './commands.js';
export { isPublicIp, readIdentityCard, type CardReader } from './infrastructure/identity-card.js';
export {
  registryCircuitsMigrationSql,
  registryMigrationSql,
} from './infrastructure/registry.tables.js';
export { riskOf } from './registry.record.js';
export type {
  IdentityCard,
  Promotion,
  Resource,
  ResourceKind,
  Risk,
  Tier,
} from './registry.record.js';
export { flagsOf, registryPermissions, registryRoutes, useCardReader } from './routes.js';
