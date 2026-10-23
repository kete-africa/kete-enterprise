import { channelsMailRefsMigrationSql, channelsMigrationSql } from '@kete/channels';
import { organizationPolicySql } from '@kete/tenancy';
import {
  threadsComfortMigrationSql,
  threadsLiveMigrationSql,
  threadsMigrationSql,
} from '@kete/threads';
import { workDelegatesMigrationSql, workPrioritiesMigrationSql } from '@kete/work';

/**
 * Threads and the router (kete-core `@kete/threads`, `@kete/channels`, with their RLS in the same
 * migration), and the mailboxes the center reads (spec 089): a person's IMAP and SMTP, her
 * password sealed (never returned), and the list of organizations the worker goes through.
 */
export function messagesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `${threadsMigrationSql(options)}
${channelsMigrationSql(options)}
create table ${s}.mailbox_accounts (
  organization_id text not null,
  user_id text not null,
  address text not null check (length(address) between 3 and 320),
  display_name text check (length(display_name) <= 120),
  imap_host text not null,
  imap_port integer not null default 993,
  smtp_host text not null,
  smtp_port integer not null default 465,
  login text not null,
  password_sealed text not null,
  active boolean not null default true,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'mailbox_accounts', appRole: options.appRole })}
grant select, insert, update on ${s}.mailbox_accounts to ${options.appRole};

create function ${s}.mailbox_organizations() returns table (organization_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select distinct organization_id from mailbox_accounts where active $$;
revoke all on function ${s}.mailbox_organizations() from public;
grant execute on function ${s}.mailbox_organizations() to ${options.appRole};
`;
}

/**
 * Threads people live in (spec 098, kete-core spec 139): the live threads of `@kete/threads` — files,
 * moves, marks, announcements —, the holdings' priorities, and the center's own tables: an app's
 * object behind its thread (« Ouvrir la fiche »), a message to the outside waiting for an approval,
 * a person's agenda feed for Outlook (only its token's hash is kept), and her daily summary by mail.
 */
export function messagesLiveMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const app = options.appRole;
  return `${threadsLiveMigrationSql(options)}
${workPrioritiesMigrationSql(options)}
create table ${s}.thread_objects (
  organization_id text not null,
  thread_id text primary key references ${s}.kete_threads (thread_id),
  product text not null check (length(product) between 1 and 80),
  href text check (href is null or href like 'https://%' or href like 'http://127.0.0.1:%'),
  party_id text,
  project_id text
);
${organizationPolicySql({ schema: s, table: 'thread_objects', appRole: app })}
grant select, insert, update on ${s}.thread_objects to ${app};

create table ${s}.outside_pending (
  organization_id text not null,
  message_id text primary key references ${s}.kete_messages (message_id),
  thread_id text not null references ${s}.kete_threads (thread_id),
  approvers text[] not null,
  policies jsonb not null default '[]',
  state text not null default 'waiting' check (state in ('waiting', 'sent', 'refused')),
  decided_by text,
  decided_at timestamptz,
  check ((state = 'waiting') = (decided_at is null))
);
${organizationPolicySql({ schema: s, table: 'outside_pending', appRole: app })}
grant select, insert, update on ${s}.outside_pending to ${app};

create table ${s}.agenda_feeds (
  organization_id text not null,
  user_id text not null,
  token_hash text not null unique check (length(token_hash) = 64),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'agenda_feeds', appRole: app })}
grant select, insert, update, delete on ${s}.agenda_feeds to ${app};
-- A calendar asks without an account: its token says whose days, across organizations.
create function ${s}.agenda_feed_owner(hash text)
  returns table (organization_id text, user_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select organization_id, user_id from agenda_feeds where token_hash = hash $$;
revoke all on function ${s}.agenda_feed_owner(text) from public;
grant execute on function ${s}.agenda_feed_owner(text) to ${app};

alter table ${s}.people
  add column threads_digest text not null default 'none' check (threads_digest in ('none', 'daily')),
  add column digest_sent_on date;
`;
}

/**
 * The enterprise talks here (spec 099; kete-core spec 140): the threads for everyone of
 * `@kete/threads` (reactions, pins, deletions, transcripts, citations, levels, imports, merging),
 * the holdings' delegates and returns, the mails a thread sent or received, and the center's own
 * table of who was told on her phone of which message — once, three minutes after it, if she had
 * not read it.
 */
export function messagesComfortMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const app = options.appRole;
  return `${workDelegatesMigrationSql(options)}
${threadsComfortMigrationSql(options)}
${channelsMailRefsMigrationSql(options)}
create table ${s}.thread_pushes (
  organization_id text not null,
  message_id text not null references ${s}.kete_messages (message_id),
  user_id text not null,
  pushed_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
${organizationPolicySql({ schema: s, table: 'thread_pushes', appRole: app })}
grant select, insert on ${s}.thread_pushes to ${app};

-- The turn of Kete or an agent that wrote a message: its steps, folded under it (FR-009, FR-014).
create table ${s}.thread_runs (
  organization_id text not null,
  message_id text primary key references ${s}.kete_messages (message_id),
  title text not null check (length(title) between 1 and 200),
  steps jsonb not null default '[]',
  seconds integer check (seconds >= 0)
);
${organizationPolicySql({ schema: s, table: 'thread_runs', appRole: app })}
grant select, insert on ${s}.thread_runs to ${app};

alter table ${s}.mailbox_accounts
  add column kind text not null default 'personal' check (kind in ('personal', 'shared')),
  add column read_sent boolean not null default true;
`;
}

/** The tables a turn's tools read, kept with its run and drawn under its answer (spec 111). */
export function runTablesMigrationSql(options: { schema: string }): string {
  return `alter table ${options.schema}.thread_runs
  add column tables jsonb not null default '[]' check (jsonb_typeof(tables) = 'array');`;
}
