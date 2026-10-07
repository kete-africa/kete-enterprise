// The workspace feature's only door: what waits for a person, and where she stands (spec 014).
export { factsFor, type Facts } from './facts.js';
export {
  sidebarMigrationSql,
  sidebarOf,
  sidebarRoutes,
  type Shortcut,
  type SidebarLayout,
} from './sidebar.js';
export { todaySessionMigrationSql, todaySessionRoutes } from './session.js';
export {
  todayFor,
  waitingCount,
  type DayItem,
  type DoneItem,
  type Meanwhile,
  type Today,
} from './today.js';
export {
  appTasksMigrationSql,
  appTasksRoutes,
  closeTask,
  openTasksOf,
  putTask,
  type AppTask,
} from './tasks.js';
