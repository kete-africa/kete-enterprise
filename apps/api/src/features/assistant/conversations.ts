import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';

/**
 * The assistant's conversations (spec 017): a person finds hers again, as in any assistant. Each
 * belongs to one person; a query never returns another's. The tools it used and the drafts it
 * prepared are kept with each answer, so the thread shows them again.
 */
export function conversationsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.assistant_conversations (
  conversation_id text primary key,
  organization_id text not null,
  user_id text not null,
  title text not null check (length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, conversation_id)
);
create index assistant_conversations_owner
  on ${s}.assistant_conversations (organization_id, user_id, updated_at desc);
${policy('assistant_conversations')}

create table ${s}.assistant_messages (
  message_id text primary key,
  organization_id text not null,
  conversation_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tools jsonb not null default '[]',
  drafts jsonb not null default '[]',
  created_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id)
    references ${s}.assistant_conversations (organization_id, conversation_id)
);
create index assistant_messages_thread
  on ${s}.assistant_messages (organization_id, conversation_id, created_at);
${policy('assistant_messages')}

grant select, insert, update on ${s}.assistant_conversations to ${options.appRole};
grant select, insert on ${s}.assistant_messages to ${options.appRole};
`;
}

export interface ToolUse {
  name: string;
  state: 'done' | 'refused';
}

/** A file sent with a message, as the thread shows it (spec 027). */
export interface MessageAttachment {
  attachmentId: string;
  name: string;
  kind: 'text' | 'image';
  pages: number | null;
}

export interface StoredMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ToolUse[];
  drafts: unknown[];
  attachments: MessageAttachment[];
  /** Where the answer comes from: the records and documents its tools returned. */
  sources: { label: string; href: string }[];
  /** The document the assistant wrote in the canvas, if any. */
  canvas: { title: string; content: string } | null;
  createdAt: string;
}

export async function listConversations(db: SqlExecutor, userId: string) {
  const { rows } = await db.query<{ conversation_id: string; title: string; updated_at: Date }>(
    `select conversation_id, title, updated_at from assistant_conversations
      where user_id = $1 order by updated_at desc limit 50`,
    [userId],
  );
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    title: r.title,
    updatedAt: r.updated_at.toISOString(),
  }));
}

/** A conversation of this person, with its messages; null when it is not hers. */
export async function readConversation(db: SqlExecutor, userId: string, conversationId: string) {
  const { rows } = await db.query<{ title: string }>(
    `select title from assistant_conversations where conversation_id = $1 and user_id = $2`,
    [conversationId, userId],
  );
  const head = rows[0];
  if (!head) return null;
  const messages = await db.query<{
    message_id: string;
    role: 'user' | 'assistant';
    content: string;
    tools: ToolUse[];
    drafts: unknown[];
    attachments: MessageAttachment[];
    sources: StoredMessage['sources'];
    canvas: StoredMessage['canvas'];
    created_at: Date;
  }>(
    `select message_id, role, content, tools, drafts, attachments, sources, canvas, created_at
       from assistant_messages
      where conversation_id = $1 order by created_at, message_id`,
    [conversationId],
  );
  return {
    conversationId,
    title: head.title,
    messages: messages.rows.map((m): StoredMessage => ({
      messageId: m.message_id,
      role: m.role,
      content: m.content,
      tools: m.tools,
      drafts: m.drafts,
      attachments: m.attachments,
      sources: m.sources,
      canvas: m.canvas,
      createdAt: m.created_at.toISOString(),
    })),
  };
}

/** Starts a conversation named after its first message. */
export async function startConversation(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  firstMessage: string,
): Promise<string> {
  const conversationId = newId('cnv');
  const title = firstMessage.replace(/\s+/g, ' ').trim().slice(0, 80) || '…';
  await db.query(
    `insert into assistant_conversations (conversation_id, organization_id, user_id, title)
     values ($1, $2, $3, $4)`,
    [conversationId, organizationId, userId, title],
  );
  return conversationId;
}

export async function appendMessage(
  db: SqlExecutor,
  organizationId: string,
  conversationId: string,
  message: {
    role: 'user' | 'assistant';
    content: string;
    tools?: ToolUse[];
    drafts?: unknown[];
    attachments?: MessageAttachment[];
    sources?: StoredMessage['sources'];
    canvas?: StoredMessage['canvas'];
  },
): Promise<void> {
  await db.query(
    `insert into assistant_messages (message_id, organization_id, conversation_id, role, content,
       tools, drafts, attachments, sources, canvas)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      newId('msg'),
      organizationId,
      conversationId,
      message.role,
      message.content,
      JSON.stringify(message.tools ?? []),
      JSON.stringify(message.drafts ?? []),
      JSON.stringify(message.attachments ?? []),
      JSON.stringify(message.sources ?? []),
      message.canvas ? JSON.stringify(message.canvas) : null,
    ],
  );
  await db.query(
    `update assistant_conversations set updated_at = now() where conversation_id = $1`,
    [conversationId],
  );
}

/**
 * What a draft's identifiers name, for the person who decides it: a person's name, a review's
 * holder, a reading's value and proof (spec 017). A draft shows words, never bare identifiers.
 */
export async function explainDraft<T extends { values: Record<string, unknown> }>(
  db: SqlExecutor,
  draft: T,
): Promise<T & { display: Record<string, string> }> {
  const display: Record<string, string> = {};
  const values = draft.values;
  const person = values['responsiblePersonId'];
  if (typeof person === 'string') {
    const { rows } = await db.query<{ name: string }>(
      `select name from people where person_id = $1`,
      [person],
    );
    if (rows[0]) display['responsiblePersonId'] = rows[0].name;
  }
  const review = values['reviewId'];
  if (typeof review === 'string') {
    const { rows } = await db.query<{ name: string; label: string }>(
      `select pe.name, q.label from reviews r join people pe on pe.person_id = r.person_id
         join performance_quarters q on q.quarter_id = r.quarter_id where r.review_id = $1`,
      [review],
    );
    if (rows[0]) display['reviewId'] = `${rows[0].name} · ${rows[0].label}`;
  }
  const reading = values['readingId'];
  if (typeof reading === 'string') {
    const { rows } = await db.query<{ indicator: string; value: string; source: string }>(
      `select indicator, value, source from indicator_readings where reading_id = $1`,
      [reading],
    );
    if (rows[0])
      display['readingId'] = `${rows[0].indicator} : ${Number(rows[0].value)} (${rows[0].source})`;
  }
  return { ...draft, display };
}
