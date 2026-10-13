// The projects feature's only door: what the organization works on (spec 074).
export { projectsPermissions, projectsRoutes } from './routes.js';
export {
  findProject,
  projectIdsOf,
  projectsFor,
  projectsMigrationSql,
  type Project,
} from './projects.js';
