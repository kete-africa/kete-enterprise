// The passes feature's only door: personal links for people without an account (spec 010).
export { passesMigrationSql } from './infrastructure/passes.tables.js';
export type { PassRow } from './infrastructure/passes.tables.js';
export {
  issuePass,
  passRoutes,
  requirePass,
  resolvePass,
  revokePasses,
  type PassContext,
  type PassVariables,
} from './passes.js';
