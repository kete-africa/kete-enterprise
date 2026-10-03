// The AI feature's only door (spec 026): each person's own connection, the organization's policy.
export {
  aiConnectionsMigrationSql,
  modelChoiceFor,
  readConnection,
  readPolicy,
  type Connection,
  type ModelChoice,
  type PersonalPolicy,
} from './connections.js';
export { useKeyChecker } from './infrastructure/key-check.js';
export { aiRoutes } from './routes.js';
