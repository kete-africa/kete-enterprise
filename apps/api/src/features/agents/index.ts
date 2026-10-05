// The agents feature's only door: what the rest of the API may use (spec 007).
export type { Agent, Finding, Signal } from './agents.record.js';
export { AgentRuleError } from './commands.js';
export { agentsMigrationSql, dueAgents } from './infrastructure/agents.tables.js';
export { agentsPermissions, agentsRoutes } from './routes.js';
export {
  agentTasksMigrationSql,
  finishedFor,
  runQueuedTasks,
  runTask,
  useTaskModel,
  type AgentTask,
} from './tasks.js';
export { wakeAgent, wakeDueAgents, type WakeReport } from './wake.js';
export { knownWatches, registerWatch, type Watch } from './watches.js';
