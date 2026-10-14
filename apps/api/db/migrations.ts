import {
  aiConnectionsMigrationSql,
  aiSubscriptionsMigrationSql,
} from '../src/features/ai/index.js';
import { aiCostMigrationSql } from '@kete/ai';
import { skillsMigrationSql } from '@kete/skills';
import {
  dashboardPinsMigrationSql,
  dashboardVersionsMigrationSql,
  dashboardsMigrationSql,
} from '../src/features/dashboards/index.js';
import { datasetsMigrationSql } from '../src/features/datasets/index.js';
import { exchangesMigrationSql } from '../src/features/exchanges/index.js';
import { receptionMigrationSql, requestsMigrationSql } from '../src/features/requests/index.js';
import { connectorsMigrationSql } from '../src/features/connectors/index.js';
import { moneyMigrationSql } from '../src/features/money/index.js';
import { timeMigrationSql } from '../src/features/time/index.js';
import { partiesMigrationSql } from '../src/features/parties/index.js';
import { projectsMigrationSql } from '../src/features/projects/index.js';
import { rulesMigrationSql } from '../src/features/rules/index.js';
import { notesAboutMigrationSql, notesMigrationSql } from '../src/features/notes/index.js';
import { routinesMigrationSql } from '../src/features/routines/index.js';
import { documentsMigrationSql } from '../src/features/documents/index.js';
import { formsMigrationSql } from '../src/features/forms/index.js';
import { dossiersMigrationSql } from '../src/features/dossiers/index.js';
import { todoMigrationSql } from '../src/features/todo/index.js';
import { knowledgeTablesSql } from '../src/features/knowledge/index.js';
import { notificationsTablesSql } from '../src/features/notifications/index.js';
import { appDecisionsMigrationSql, appEventsMigrationSql } from '../src/features/apps/index.js';
import { commandsDelegationMigrationSql, commandsMigrationSql } from '@kete/commands';
import { outboxMigrationSql } from '@kete/sdk';
import {
  agentAutonomyMigrationSql,
  agentsAtWorkMigrationSql,
  agentTasksMigrationSql,
  agentsMigrationSql,
} from '../src/features/agents/index.js';
import { complianceMigrationSql } from '../src/features/compliance/index.js';
import {
  circuitsCompletedMigrationSql,
  decisionsMigrationSql,
} from '../src/features/decisions/index.js';
import { gatewayAppendOnlySql, gatewayMigrationSql } from '../src/features/gateway/index.js';
import { actionsMigrationSql } from '../src/features/actions/index.js';
import { draftsMigrationSql } from '@kete/drafts';
import {
  assistantMigrationSql,
  chatMigrationSql,
  conversationsMigrationSql,
  feedbackMigrationSql,
  memoryMigrationSql,
  schedulesMigrationSql,
  tablesMigrationSql,
  viewsMigrationSql,
} from '../src/features/assistant/index.js';
import { mailMigrationSql } from '../src/features/mail/index.js';
import {
  meetingRecordsMigrationSql,
  meetingsMigrationSql,
} from '../src/features/meetings/index.js';
import { organizationMigrationSql } from '../src/features/organization/index.js';
import { passesMigrationSql } from '../src/features/passes/index.js';
import {
  performanceMigrationSql,
  readingsMigrationSql,
} from '../src/features/performance/index.js';
import {
  registryCircuitsMigrationSql,
  registryMigrationSql,
} from '../src/features/registry/index.js';
import { rightsMigrationSql } from '../src/features/rights/index.js';
import { structureMigrationSql } from '../src/features/structure/index.js';
import { surveysMigrationSql } from '../src/features/surveys/index.js';
import {
  appTasksMigrationSql,
  sidebarMigrationSql,
  taskPathsMigrationSql,
  todaySessionMigrationSql,
} from '../src/features/workspace/index.js';
import { appRequestsMigrationSql } from '../src/features/app-requests/index.js';
import { phoneMigrationSql } from '../src/features/phone/index.js';

export interface MigrationContext {
  schema: string;
  appRole: string;
  ownerRole: string;
}

export interface Migration {
  name: string;
  sql(context: MigrationContext): string;
}

/**
 * Kete Enterprise's migrations, in order; never edit one that ran. Every table comes with its
 * row-level security in the same migration (constitution V).
 */
export const migrations: Migration[] = [
  {
    // What kete-core provides: the command journal (with its chain of agents) and the event outbox.
    name: '0000_kete',
    sql: (context) =>
      [
        commandsMigrationSql(context),
        commandsDelegationMigrationSql(context),
        outboxMigrationSql(context),
      ].join('\n'),
  },
  // Units, positions, people and dated assignments (spec 002).
  { name: '0001_structure', sql: (context) => structureMigrationSql(context) },
  // Roles and their grants, scoped to a subtree, a country or the organization (spec 003).
  { name: '0002_rights', sql: (context) => rightsMigrationSql(context) },
  // Apps, skills, MCP servers and agents, with their tier and risk (spec 004).
  { name: '0003_registry', sql: (context) => registryMigrationSql(context) },
  // Approval circuits, their requests and steps (spec 005); promotions may go through them.
  { name: '0004_decisions', sql: (context) => decisionsMigrationSql(context) },
  { name: '0005_registry_circuits', sql: (context) => registryCircuitsMigrationSql(context) },
  // Every call through the MCP gateway (spec 006).
  { name: '0006_gateway', sql: (context) => gatewayMigrationSql(context) },
  // Agents with a job description, and their signals (spec 007).
  { name: '0007_agents', sql: (context) => agentsMigrationSql(context) },
  // Frameworks, requirements, shared controls, evidence, documents, audits, findings, corrective
  // actions and certificates (spec 008).
  { name: '0008_compliance', sql: (context) => complianceMigrationSql(context) },
  { name: '0009_gateway_append_only', sql: (context) => gatewayAppendOnlySql(context) },
  // Modules and settings per organization, personal links, e-mails and the test outbox (spec 010).
  {
    name: '0010_foundation',
    sql: (context) =>
      [
        organizationMigrationSql(context),
        passesMigrationSql(context),
        mailMigrationSql(context),
      ].join('\n'),
  },
  // Questionnaires, campaigns, respondents and their forms (spec 011).
  { name: '0011_surveys', sql: (context) => surveysMigrationSql(context) },
  // Indicators, job profiles, quarters, reviews and their frozen lines (spec 012).
  { name: '0012_performance', sql: (context) => performanceMigrationSql(context) },
  // The one register of actions; meetings, their decisions and records; decision notes (spec 013).
  {
    name: '0013_meetings',
    sql: (context) => [actionsMigrationSql(context), meetingsMigrationSql(context)].join('\n'),
  },
  // The use of models and their budgets (@kete/ai), and the morning briefings (spec 014).
  { name: '0014_assistant', sql: (context) => assistantMigrationSql(context) },
  // Readings of indicators sent by connected apps (spec 015).
  { name: '0015_readings', sql: (context) => readingsMigrationSql(context) },
  // Drafts prepared by agents, decided by people; the assistant's conversations (spec 017).
  {
    name: '0016_drafts_and_conversations',
    sql: (context) =>
      [
        draftsMigrationSql({ schema: context.schema, appRole: context.appRole }),
        conversationsMigrationSql(context),
      ].join('\n'),
  },
  // Tasks the team's apps put in a person's To do (spec 018).
  { name: '0017_app_tasks', sql: (context) => appTasksMigrationSql(context) },
  // App requests: a person asks, IT decides, the factory creates (spec 021).
  { name: '0018_app_requests', sql: (context) => appRequestsMigrationSql(context) },
  // The apps' business events, kept once per organization (spec 025).
  { name: '0019_app_events', sql: (context) => appEventsMigrationSql(context) },
  // Decisions asked by apps, decided by the organization's circuits (spec 023).
  { name: '0020_app_decisions', sql: (context) => appDecisionsMigrationSql(context) },
  // Each person's own AI connection, and who pays for the models (spec 026).
  { name: '0021_ai_connections', sql: (context) => aiConnectionsMigrationSql(context) },
  // The chat of the current era: attachments, sources, canvas (spec 027).
  { name: '0022_assistant_chat', sql: (context) => chatMigrationSql(context) },
  // Each person's own AI subscription, on her own machine (spec 026b).
  { name: '0023_ai_subscriptions', sql: (context) => aiSubscriptionsMigrationSql(context) },
  // Each person's scheduled tasks: her morning briefing, her questions at a set time (spec 029).
  { name: '0024_assistant_schedules', sql: (context) => schedulesMigrationSql(context) },
  // The team's apps' views shown in the chat, kept with each answer (spec 030).
  { name: '0025_assistant_views', sql: (context) => viewsMigrationSql(context) },
  // The company's library: sources, documents, passages, with pgvector (spec 028).
  { name: '0026_knowledge', sql: (context) => knowledgeTablesSql(context) },
  // What a person's assistant remembers about her (spec 029).
  { name: '0027_assistant_memories', sql: (context) => memoryMigrationSql(context) },
  // Her notifications and the devices she is told on (spec 030).
  { name: '0028_notifications', sql: (context) => notificationsTablesSql(context) },
  // Dossiers: one space per subject, its members, its links (spec 034).
  { name: '0029_dossiers', sql: (context) => dossiersMigrationSql(context) },
  // Documents: the organization's Word templates, what each person produced (spec 038).
  { name: '0030_documents', sql: (context) => documentsMigrationSql(context) },
  // The organization's skills and their versions (spec 031, @kete/skills).
  { name: '0031_skills', sql: (context) => skillsMigrationSql(context) },
  // What each model call cost (spec 037, @kete/ai).
  { name: '0032_ai_costs', sql: (context) => aiCostMigrationSql(context) },
  // A meeting's transcript and the record the model proposes (spec 035).
  { name: '0033_meeting_records', sql: (context) => meetingRecordsMigrationSql(context) },
  // A team's tables, kept as rows (spec 031).
  { name: '0034_team_datasets', sql: (context) => datasetsMigrationSql(context) },
  // Forms: collections answered by link or in the space, through a circuit (spec 032).
  { name: '0035_forms', sql: (context) => formsMigrationSql(context) },
  // Dashboards over the organization's data (spec 033).
  { name: '0036_dashboards', sql: (context) => dashboardsMigrationSql(context) },
  // Tasks given to agents, run in the background, handed on between agents (spec 036).
  { name: '0037_agent_tasks', sql: (context) => agentTasksMigrationSql(context) },
  // Dashboards pinned on a person's « Aujourd'hui » (spec 046).
  { name: '0038_dashboard_pins', sql: (context) => dashboardPinsMigrationSql(context) },
  // A decision's analysis for its reader, and its discussion (spec 047).
  { name: '0039_decision_todo', sql: (context) => todoMigrationSql(context) },
  // The sidebar each person arranges (spec 049).
  { name: '0040_sidebar_layouts', sql: (context) => sidebarMigrationSql(context) },
  // Dashboards' versions and readers' own versions (spec 050).
  { name: '0041_dashboard_versions', sql: (context) => dashboardVersionsMigrationSql(context) },
  // Routines: triggers on the apps' events, watches on figures, every run kept (spec 051).
  { name: '0042_routines', sql: (context) => routinesMigrationSql(context) },
  // An agent's level per kind of task (spec 052).
  { name: '0043_agent_autonomy', sql: (context) => agentAutonomyMigrationSql(context) },
  // What each person says of an answer (spec 053).
  { name: '0044_assistant_feedback', sql: (context) => feedbackMigrationSql(context) },
  // Her notebook: notes understood, a reminder filed when they name a moment (spec 055).
  { name: '0045_person_notes', sql: (context) => notesMigrationSql(context) },
  // Exchanges between assistants: what each person allows, every exchange kept (spec 057).
  { name: '0046_assistant_exchanges', sql: (context) => exchangesMigrationSql(context) },
  // « Aujourd'hui » as a session: what a person sets aside for the day (spec 058).
  { name: '0047_today_set_aside', sql: (context) => todaySessionMigrationSql(context) },
  // A note says what it reports on: a report dictated in the field (spec 059).
  { name: '0048_person_notes_about', sql: (context) => notesAboutMigrationSql(context) },
  // A task may lead to a page of the space by its path (spec 062).
  { name: '0049_task_paths', sql: (context) => taskPathsMigrationSql(context) },
  // The tables of an answer, kept with it (spec 063).
  { name: '0050_assistant_tables', sql: (context) => tablesMigrationSql(context) },
  // Work asked of a colleague, its states and its thread (spec 065, doctrine D-044).
  { name: '0051_colleague_requests', sql: (context) => requestsMigrationSql(context) },
  // Tasks steered while they run, agents private or shared (spec 066, doctrine D-044).
  { name: '0052_agents_at_work', sql: (context) => agentsAtWorkMigrationSql(context) },
  // « Mon accueil »: her rules and her absence (spec 067, doctrine D-044).
  { name: '0053_reception', sql: (context) => receptionMigrationSql(context) },
  // The organization's rules for its agents, and what they refused (spec 068, doctrine D-043).
  { name: '0054_ai_rules', sql: (context) => rulesMigrationSql(context) },
  // Connectors: a business tool read through its MCP server (spec 069).
  { name: '0055_connectors', sql: (context) => connectorsMigrationSql(context) },
  // Third parties: who the organization works with, one record each (spec 073, doctrine D-047).
  { name: '0056_parties', sql: (context) => partiesMigrationSql(context) },
  // Projects: one object — a dossier, a team, a client, a budget by post (spec 074, D-047).
  { name: '0057_projects', sql: (context) => projectsMigrationSql(context) },
  // The facts of money the apps say, by project (spec 076, doctrine D-049).
  { name: '0058_money_facts', sql: (context) => moneyMigrationSql(context) },
  // Circuits completed: sent back for correction, informed, a project's lead (spec 075).
  { name: '0059_circuits_completed', sql: (context) => circuitsCompletedMigrationSql(context) },
  // WhatsApp and Telegram: senders, phones tied, every message (spec 077).
  { name: '0060_phone', sql: (context) => phoneMigrationSql(context) },
  // The time the apps say, for Planifier (spec 079, doctrine D-050).
  { name: '0061_time_facts', sql: (context) => timeMigrationSql(context) },
];
