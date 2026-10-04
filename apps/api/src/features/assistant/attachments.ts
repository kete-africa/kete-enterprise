import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { extract, readable, type AttachmentKind } from '../../platform/extract.js';

// Files attached to the chat (spec 027): read once when attached, kept with the person's
// conversation, under its organization's row-level security. What reaches the model is the text
// read from them, or the image itself — never the file anywhere else.

export function chatMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
alter table ${s}.assistant_messages
  add column attachments jsonb not null default '[]',
  add column sources jsonb not null default '[]',
  add column canvas jsonb;

create table ${s}.assistant_attachments (
  attachment_id text primary key,
  organization_id text not null,
  user_id text not null,
  conversation_id text,
  name text not null check (length(name) between 1 and 200),
  content_type text not null,
  size integer not null check (size between 1 and 10485760),
  kind text not null check (kind in ('text', 'image')),
  pages integer,
  text text not null default '',
  data bytea,
  created_at timestamptz not null default now()
);
create index assistant_attachments_owner on ${s}.assistant_attachments (organization_id, user_id);
${organizationPolicySql({ schema: s, table: 'assistant_attachments', appRole: options.appRole })}
grant select, insert, update on ${s}.assistant_attachments to ${options.appRole};
`;
}

/** At most 10 MB a file; a text read from it is cut at 60 000 characters for the model. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 60_000;

export interface AttachmentInfo {
  attachmentId: string;
  name: string;
  contentType: string;
  size: number;
  kind: AttachmentKind;
  pages: number | null;
}

export class AttachmentError extends Error {
  constructor(readonly code: 'unsupported_file' | 'file_too_large' | 'unreadable_file') {
    super(code);
    this.name = 'AttachmentError';
  }
}

/** Reads and keeps a file the person attached; refuses what the chat cannot read. */
export async function saveAttachment(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  file: { name: string; contentType: string; data: Buffer },
): Promise<AttachmentInfo> {
  if (!readable(file.contentType)) throw new AttachmentError('unsupported_file');
  if (file.data.length === 0 || file.data.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError('file_too_large');
  }
  const read = await extract(file.contentType, file.data).catch(() => {
    throw new AttachmentError('unreadable_file');
  });
  const attachmentId = newId('att');
  await db.query(
    `insert into assistant_attachments (attachment_id, organization_id, user_id, name,
       content_type, size, kind, pages, text, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      attachmentId,
      organizationId,
      userId,
      file.name.slice(0, 200),
      file.contentType,
      file.data.length,
      read.kind,
      read.pages,
      read.text.slice(0, MAX_TEXT),
      read.kind === 'image' ? file.data : null,
    ],
  );
  return {
    attachmentId,
    name: file.name.slice(0, 200),
    contentType: file.contentType,
    size: file.data.length,
    kind: read.kind,
    pages: read.pages,
  };
}

export interface AttachmentContent extends AttachmentInfo {
  text: string;
  data: Buffer | null;
}

/**
 * The person's own attachments, by id, linked now to the conversation they are sent in: another
 * person's, or one already sent in another conversation, is left out.
 */
export async function takeAttachments(
  db: SqlExecutor,
  userId: string,
  conversationId: string,
  ids: string[],
): Promise<AttachmentContent[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<{
    attachment_id: string;
    name: string;
    content_type: string;
    size: number;
    kind: AttachmentKind;
    pages: number | null;
    text: string;
    data: Buffer | null;
  }>(
    `update assistant_attachments set conversation_id = $3
      where attachment_id = any($1) and user_id = $2
        and (conversation_id is null or conversation_id = $3)
      returning attachment_id, name, content_type, size, kind, pages, text, data`,
    [ids, userId, conversationId],
  );
  return rows.map((r) => ({
    attachmentId: r.attachment_id,
    name: r.name,
    contentType: r.content_type,
    size: r.size,
    kind: r.kind,
    pages: r.pages,
    text: r.text,
    data: r.data,
  }));
}
