// The rights feature's only door: what the rest of the API may use (spec 003).
export { createRole, grantRole, RightsRuleError, setRolePermissionsCommand } from './commands.js';
export { listRoles } from './infrastructure/rights.tables.js';
export { rightsMigrationSql } from './infrastructure/rights.tables.js';
export {
  covers,
  isAdministrator,
  reach,
  reachesAnything,
  unitsOfPerson,
  unitsOfPersonAndAbove,
} from './rights.js';
export type { Grant, Reach, Role } from './rights.record.js';
export { rightsRoutes } from './routes.js';

/** The permissions this feature declares. */
export const rightsPermissions = ['rights:manage'] as const;
