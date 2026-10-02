import { commandsDelegationMigrationSql, commandsMigrationSql } from '@kete/commands';
import { outboxMigrationSql } from '@kete/sdk';
import { agentsMigrationSql } from '../src/features/agents/index.js';
import { complianceMigrationSql } from '../src/features/compliance/index.js';
import { decisionsMigrationSql } from '../src/features/decisions/index.js';
import { gatewayAppendOnlySql, gatewayMigrationSql } from '../src/features/gateway/index.js';
import { actionsMigrationSql } from '../src/features/actions/index.js';
import { mailMigrationSql } from '../src/features/mail/index.js';
import { meetingsMigrationSql } from '../src/features/meetings/index.js';
import { organizationMigrationSql } from '../src/features/organization/index.js';
import { passesMigrationSql } from '../src/features/passes/index.js';
import { performanceMigrationSql } from '../src/features/performance/index.js';
import {
  registryCircuitsMigrationSql,
  registryMigrationSql,
} from '../src/features/registry/index.js';
import { rightsMigrationSql } from '../src/features/rights/index.js';
import { structureMigrationSql } from '../src/features/structure/index.js';
import { surveysMigrationSql } from '../src/features/surveys/index.js';

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
];
