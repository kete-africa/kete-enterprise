// The structure feature's only door: what the rest of the API may use (spec 002).
export { StructureRuleError } from './commands.js';
export { structureMigrationSql } from './infrastructure/structure.tables.js';
export { structureRoutes } from './routes.js';
export type {
  Assignment,
  AssignmentKind,
  Chart,
  Person,
  Position,
  Unit,
  UnitType,
} from './structure.record.js';
