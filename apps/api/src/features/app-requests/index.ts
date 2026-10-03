// The app requests feature's only door (spec 021): a person asks, IT decides, the factory creates.
export {
  appRequestInput,
  appRequestsMigrationSql,
  decideAppRequest,
  submitAppRequest,
  type AppRequest,
} from './app-requests.js';
export { appRequestRoutes, factoryReportRoutes } from './routes.js';
