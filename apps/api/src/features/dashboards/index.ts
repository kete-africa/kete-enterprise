// Dashboards' only door (spec 033): their table, their routes, the assistant's tool.
export {
  dashboardPinsMigrationSql,
  dashboardsMigrationSql,
  dashboardVersionsMigrationSql,
  type Dashboard,
} from './dashboards.js';
export {
  dashboardRoutes,
  dashboardsOpen,
  dashboardTools,
  figuresFor,
  periodDates,
  pinnedDashboardsFor,
  readFigure,
  type Card,
} from './routes.js';
