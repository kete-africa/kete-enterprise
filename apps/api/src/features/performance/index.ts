// The performance feature's only door (spec 012).
export {
  createQuarter,
  importReferential,
  PerformanceRuleError,
  recordMeasure,
  reviewPurpose,
} from './commands.js';
export {
  colourOf,
  defaultScale,
  factorOf,
  fallbackOf,
  individualOf,
  type Colour,
  type Comparison,
  type ReviewLine,
  type Scale,
} from './compute.js';
export {
  findReview,
  listQuarters,
  listReviews,
  performanceMigrationSql,
} from './infrastructure/performance.tables.js';
export type { Profile, Quarter, Review } from './infrastructure/performance.tables.js';
export { profileInput, type ProfileInput } from './performance.record.js';
export { measureFromReading, readingsMigrationSql, readingsToTake } from './readings.js';
export { performancePermissions, performancePublicRoutes, performanceRoutes } from './routes.js';
