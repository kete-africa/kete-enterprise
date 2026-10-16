import { channelsMigrationSql } from '@kete/channels';
import { organizationPolicySql } from '@kete/tenancy';
import { threadsMigrationSql } from '@kete/threads';

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
