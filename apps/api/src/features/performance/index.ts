// The performance feature's only door (spec 012).
export {
  createQuarter,
  importReferential,
  PerformanceRuleError,
  reviewPurpose,
} from './commands.js';
export {
  colourOf,
  defaultScale,
  factorOf,
  fallbackOf,
  individualOf,
  type Colour,
  type ReviewLine,
  type Scale,
} from './compute.js';
export { performanceMigrationSql } from './infrastructure/performance.tables.js';
export type { Profile, Quarter, Review } from './infrastructure/performance.tables.js';
export { profileInput, type ProfileInput } from './performance.record.js';
export { performancePermissions, performancePublicRoutes, performanceRoutes } from './routes.js';
