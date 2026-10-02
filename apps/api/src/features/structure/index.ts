// The structure feature's only door: what the rest of the API may use (spec 002).
export { chartFor } from './chart.js';
export { managerOfPosition, reportingLines, type ReportingLines } from './lines.js';
export {
  addPerson,
  assignPerson,
  createPosition,
  createUnit,
  createUnitType,
  linkAccountByEmail,
  StructureRuleError,
} from './commands.js';
export {
  findPerson,
  holdersAt,
  personOfAccount,
  unlinkedPeopleWithEmail,
} from './infrastructure/structure.tables.js';
export { structureMigrationSql } from './infrastructure/structure.tables.js';
export { structurePermissions, structureRoutes } from './routes.js';
export type {
  Assignment,
  AssignmentKind,
  Chart,
  Person,
  Position,
  Unit,
  UnitType,
} from './structure.record.js';
