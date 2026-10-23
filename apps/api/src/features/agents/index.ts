// The agents feature's only door: what the rest of the API may use (spec 007).
export type { Agent, Finding, Signal } from './agents.record.js';
export { jobInput } from './agents.record.js';
export { AgentRuleError, setAgentJob } from './commands.js';
export {
  agentAutonomyMigrationSql,
  agentSourcesMigrationSql,
  agentsMigrationSql,
  dueAgents,
} from './infrastructure/agents.tables.js';
export type { How } from './how.js';
export { useAgentModel } from './record.js';
export { agentsPermissions, agentsRoutes } from './routes.js';
export { findAgent, personOfAgent } from './infrastructure/agents.tables.js';
export {
  agentsAtWorkMigrationSql,
  agentTasksMigrationSql,
  getTask,
  queueTask,
  failedTasksSince,
  finishedFor,
  ongoingFor,
  runQueuedTasks,
  runTask,
  stateOfAgent,
  stopTask,
  useTaskModel,
  writeToTask,
  type AgentState,
  type AgentTask,
} from './tasks.js';
export { wakeAgent, wakeDueAgents, type WakeReport } from './wake.js';
export { knownWatches, registerWatch, type Watch } from './watches.js';
export {
  catalogueOf,
  centerTemplates,
  enableAgentTemplate,
  takeAgentTemplate,
  type CatalogueEntry,
} from './catalogue.js';
export { objectContextFor } from './context.js';
export { agentToolSets, keteToolSets, KETE_SOURCES } from './toolsets.js';
export { budgetOf, budgetSpent, setAgentBudget, type AgentBudget } from './budget.js';
export {
  askEvaluation,
  casesOf,
  evaluationsMigrationSql,
  evaluationsOf,
  runEvaluation,
  runWaitingEvaluations,
  THRESHOLD,
  useEvaluationModel,
  writeEvalCase,
} from './evaluations.js';
