// The decisions feature's only door: what the rest of the API may use (spec 005).
export { DecisionRuleError } from './commands.js';
export type { Circuit, DecisionRequest } from './decisions.record.js';
export {
  knownSubjects,
  onDecided,
  onWaiting,
  openRequest,
  registerSubject,
  registerSubjectFamily,
  subjectsOf,
  type SubjectHandler,
} from './engine.js';
export { findRequest } from './infrastructure/decisions.tables.js';
export { decisionsMigrationSql } from './infrastructure/decisions.tables.js';
export { decisionsPermissions, decisionsRoutes, inboxFor } from './routes.js';
