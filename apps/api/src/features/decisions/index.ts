// The decisions feature's only door: what the rest of the API may use (spec 005).
export { DecisionRuleError } from './commands.js';
export type { Circuit, DecisionRequest } from './decisions.record.js';
export { knownSubjects, openRequest, registerSubject, type SubjectHandler } from './engine.js';
export { decisionsMigrationSql } from './infrastructure/decisions.tables.js';
export { decisionsPermissions, decisionsRoutes } from './routes.js';
