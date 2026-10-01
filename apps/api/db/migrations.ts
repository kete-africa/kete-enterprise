import { commandsDelegationMigrationSql, commandsMigrationSql } from '@kete/commands';
import { outboxMigrationSql } from '@kete/sdk';
import { structureMigrationSql } from '../src/features/structure/index.js';

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
];
