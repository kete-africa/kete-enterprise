import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type pg from 'pg';

/**
 * E-mails, queued in the transaction of the gesture that writes them (spec 010), with row-level
 * security in the same migration. Captured ones stay for the test outbox; sent ones lose their
 * content, which may carry a personal link.
 */
export function mailMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.mail_messages (
  message_id text primary key,
  organization_id text not null,
  recipient text not null check (length(recipient) between 3 and 320),
  subject text not null check (length(subject) between 1 and 300),
  html text not null,
  body_text text not null,
  purpose text not null check (purpose ~ '^[a-z]+\\.[a-z_]+$'),
  status text not null check (status in ('captured', 'queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index mail_messages_status on ${s}.mail_messages (organization_id, status, created_at);
${organizationPolicySql({ schema: s, table: 'mail_messages', appRole: options.appRole })}
grant select, insert, update on ${s}.mail_messages to ${options.appRole};

create function ${s}.mail_waiting() returns table (organization_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select distinct organization_id from mail_messages where status = 'queued' $$;
revoke all on function ${s}.mail_waiting() from public;
grant execute on function ${s}.mail_waiting() to ${options.appRole};
`;
}

export interface MailRow {
  messageId: string;
  recipient: string;
  subject: string;
  purpose: string;
  status: 'captured' | 'queued' | 'sent' | 'failed';
  createdAt: string;
}

export async function insertMail(
  db: SqlExecutor,
  organizationId: string,
  input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    purpose: string;
    status: 'captured' | 'queued';
  },
): Promise<string> {
  const messageId = newId('mail');
  await db.query(
    `insert into mail_messages (message_id, organization_id, recipient, subject, html, body_text,
       purpose, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      messageId,
      organizationId,
      input.to,
      input.subject,
      input.html,
      input.text,
      input.purpose,
      input.status,
    ],
  );
  return messageId;
}

export async function listCaptured(db: SqlExecutor, limit = 200): Promise<MailRow[]> {
  const { rows } = await db.query<{
    message_id: string;
    recipient: string;
    subject: string;
    purpose: string;
    status: MailRow['status'];
    created_at: Date;
  }>(
    `select message_id, recipient, subject, purpose, status, created_at from mail_messages
      where status = 'captured' order by created_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    messageId: r.message_id,
    recipient: r.recipient,
    subject: r.subject,
    purpose: r.purpose,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function readCaptured(
  db: SqlExecutor,
  messageId: string,
): Promise<{ subject: string; recipient: string; html: string; text: string } | null> {
  const { rows } = await db.query<{
    subject: string;
    recipient: string;
    html: string;
    body_text: string;
  }>(
    `select subject, recipient, html, body_text from mail_messages
      where message_id = $1 and status = 'captured'`,
    [messageId],
  );
  const row = rows[0];
  return row
    ? { subject: row.subject, recipient: row.recipient, html: row.html, text: row.body_text }
    : null;
}

export async function organizationsWithQueuedMail(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ organization_id: string }>(
    `select organization_id from mail_waiting()`,
  );
  return rows.map((r) => r.organization_id);
}

export async function takeQueued(
  db: SqlExecutor,
  limit: number,
): Promise<{ messageId: string; to: string; subject: string; html: string; text: string }[]> {
  const { rows } = await db.query<{
    message_id: string;
    recipient: string;
    subject: string;
    html: string;
    body_text: string;
  }>(
    `select message_id, recipient, subject, html, body_text from mail_messages
      where status = 'queued' order by created_at limit $1 for update skip locked`,
    [limit],
  );
  return rows.map((r) => ({
    messageId: r.message_id,
    to: r.recipient,
    subject: r.subject,
    html: r.html,
    text: r.body_text,
  }));
}

export async function markSent(db: SqlExecutor, messageId: string): Promise<void> {
  // Once sent, the content goes: it may hold a personal link.
  await db.query(
    `update mail_messages set status = 'sent', sent_at = now(), html = '', body_text = ''
      where message_id = $1`,
    [messageId],
  );
}

export async function markFailed(db: SqlExecutor, messageId: string, error: string) {
  await db.query(`update mail_messages set status = 'failed', error = $2 where message_id = $1`, [
    messageId,
    error.slice(0, 500),
  ]);
}
