import {
  imapMailbox,
  readMailbox,
  smtpSender,
  type MailAccount,
  type Mailbox,
  type MailSender,
} from '@kete/channels';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { getPool, transaction } from '../../platform/db.js';
import { open, seal, secretsOn } from '../../platform/secrets.js';
import { centerRouter } from './center.js';
import { touchesObjects } from './mail-settings.js';

// A person's mailbox in the center (spec 089, FR-004): an administrator connects it — IMAP to
// read, SMTP to answer from her own box —, its password sealed and never returned. The worker
// reads each mailbox every minute and routes each mail into its object's thread.

export interface MailboxAccount {
  userId: string;
  address: string;
  name: string | null;
  imap: MailAccount;
  smtp: MailAccount;
  /** Shared, it is read whole; personal, only what touches the objects (spec 099, FR-018). */
  kind: 'personal' | 'shared';
  readSent: boolean;
  sentFolder: string;
  keteFolder: string;
}

let factory: {
  mailbox: (account: MailboxAccount) => Mailbox;
  sender: (account: MailboxAccount) => MailSender;
} = {
  mailbox: (account) => imapMailbox(account.imap),
  sender: (account) => smtpSender(account.smtp),
};

/** Tests and the demo: mailboxes and senders in memory. */
export function useMailboxes(next: typeof factory | undefined): void {
  factory = next ?? {
    mailbox: (account) => imapMailbox(account.imap),
    sender: (account) => smtpSender(account.smtp),
  };
}

export const mailboxInput = z.object({
  userId: z.string().regex(/^usr_[A-Za-z0-9_-]{2,64}$/),
  address: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().max(120).optional(),
  imapHost: z.string().trim().min(3).max(200),
  imapPort: z.number().int().min(1).max(65535).default(993),
  smtpHost: z.string().trim().min(3).max(200),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  login: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(500),
  kind: z.enum(['personal', 'shared']).default('personal'),
  label: z.string().trim().max(120).optional(),
  readSent: z.boolean().default(true),
  sentFolder: z.string().trim().min(1).max(200).default('Sent'),
  keteFolder: z.string().trim().min(1).max(200).default('Kete'),
});

export class MailboxError extends Error {
  constructor(
    readonly code: 'secrets_off',
    message: string,
  ) {
    super(message);
    this.name = 'MailboxError';
  }
}

/** An administrator connects a person's mailbox: its password is sealed at once. */
export async function saveMailbox(
  db: SqlExecutor,
  organizationId: string,
  input: z.output<typeof mailboxInput>,
  by: string,
): Promise<void> {
  if (!secretsOn()) throw new MailboxError('secrets_off', 'This instance keeps no secret.');
  await db.query(
    `insert into mailbox_accounts (organization_id, user_id, address, display_name, imap_host,
       imap_port, smtp_host, smtp_port, login, password_sealed, updated_by, kind, label,
       read_sent, sent_folder, kete_folder)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     on conflict (organization_id, user_id) do update set address = excluded.address,
       display_name = excluded.display_name, imap_host = excluded.imap_host,
       imap_port = excluded.imap_port, smtp_host = excluded.smtp_host,
       smtp_port = excluded.smtp_port, login = excluded.login,
       password_sealed = excluded.password_sealed, active = true,
       updated_by = excluded.updated_by, kind = excluded.kind, label = excluded.label,
       read_sent = excluded.read_sent, sent_folder = excluded.sent_folder,
       kete_folder = excluded.kete_folder, updated_at = now()`,
    [
      organizationId,
      input.userId,
      input.address,
      input.name ?? null,
      input.imapHost,
      input.imapPort,
      input.smtpHost,
      input.smtpPort,
      input.login,
      seal(input.password),
      by,
      input.kind,
      input.label || null,
      input.readSent,
      input.sentFolder,
      input.keteFolder,
    ],
  );
}

type AccountRow = {
  user_id: string;
  address: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  login: string;
  password_sealed: string;
  kind: 'personal' | 'shared';
  read_sent: boolean;
  sent_folder: string;
  kete_folder: string;
};

const accountOf = (row: AccountRow): MailboxAccount | null => {
  const password = open(row.password_sealed);
  if (password === null) return null;
  const common = { user: row.login, password };
  // TLS from the start on the usual ports (993, 465); STARTTLS on the others (143, 587).
  return {
    userId: row.user_id,
    address: row.address,
    name: row.display_name,
    imap: { host: row.imap_host, port: row.imap_port, secure: row.imap_port === 993, ...common },
    smtp: { host: row.smtp_host, port: row.smtp_port, secure: row.smtp_port === 465, ...common },
    kind: row.kind,
    readSent: row.read_sent,
    sentFolder: row.sent_folder,
    keteFolder: row.kete_folder,
  };
};

const COLUMNS = `user_id, address, display_name, imap_host, imap_port, smtp_host, smtp_port, login,
  password_sealed, kind, read_sent, sent_folder, kete_folder`;

/** Her mailbox, opened: null when none is connected or its seal no longer opens. */
export async function mailboxOf(db: SqlExecutor, userId: string): Promise<MailboxAccount | null> {
  const { rows } = await db.query<AccountRow>(
    `select ${COLUMNS} from mailbox_accounts where user_id = $1 and active`,
    [userId],
  );
  return rows[0] ? accountOf(rows[0]) : null;
}

/** The mailboxes, as administrators read them: never a password. */
export async function listMailboxes(db: SqlExecutor) {
  const { rows } = await db.query<{
    user_id: string;
    address: string;
    imap_host: string;
    smtp_host: string;
    active: boolean;
    updated_at: Date;
  }>(
    `select user_id, address, imap_host, smtp_host, active, updated_at from mailbox_accounts
      order by address`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    address: r.address,
    imapHost: r.imap_host,
    smtpHost: r.smtp_host,
    active: r.active,
    updatedAt: r.updated_at.toISOString(),
  }));
}

/** What sends from her box, and keeps it in her Sent folder. */
export function senderOf(account: MailboxAccount) {
  return { sender: factory.sender(account), mailbox: factory.mailbox(account) };
}

/** Reads one organization's mailboxes and routes what is new; a mailbox that fails waits. */
export async function readMailboxesOf(db: SqlExecutor, organizationId: string): Promise<number> {
  const { rows } = await db.query<AccountRow>(
    `select ${COLUMNS} from mailbox_accounts where active order by user_id`,
  );
  const options = await centerRouter(db, organizationId);
  let routed = 0;
  for (const row of rows) {
    const account = accountOf(row);
    if (!account) continue;
    const mailbox = factory.mailbox(account);
    // Shared, read whole; personal, only what touches the objects — and the « Kete » folder
    // she drops a mail in, whole. Its Sent folder by the same rule, when it is read (FR-018).
    const accept = account.kind === 'shared' ? undefined : touchesObjects(db, options);
    const reads = [
      { key: account.userId, mailbox, ...(accept ? { accept } : {}) },
      ...(account.kind === 'personal'
        ? [{ key: account.userId, mailbox, folder: account.keteFolder }]
        : []),
      ...(account.readSent
        ? [
            {
              key: account.userId,
              mailbox,
              folder: account.sentFolder,
              direction: 'out' as const,
              ...(accept ? { accept } : {}),
            },
          ]
        : []),
    ];
    for (const read of reads) {
      try {
        const done = await readMailbox(db, organizationId, read, options);
        routed += done.length;
      } catch (error) {
        // A folder the box does not have waits; the others are read.
        console.error(
          `[mailboxes] ${account.address}${read.folder ? ` ${read.folder}` : ''}`,
          (error as Error).message,
        );
      }
    }
  }
  return routed;
}

/** The worker, every minute: every organization with a mailbox. */
export async function readMailboxes(): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string }>(
    'select organization_id from mailbox_organizations()',
  );
  let routed = 0;
  for (const { organization_id: organizationId } of rows) {
    routed += await transaction(organizationId, (db) => readMailboxesOf(db, organizationId)).catch(
      (error: unknown) => {
        console.error(`[mailboxes] ${organizationId}`, error);
        return 0;
      },
    );
  }
  return routed;
}
