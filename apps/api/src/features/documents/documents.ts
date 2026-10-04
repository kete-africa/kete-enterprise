import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// Documents (spec 038): the organization's Word templates, filled for a person into a final .docx
// or a PDF, and what she produced — kept for her alone, downloadable, never sent anywhere else.

export function documentsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.document_templates (
  organization_id text not null,
  template_id text not null,
  name text not null check (length(name) between 1 and 160),
  description text check (length(description) <= 1000),
  fields text[] not null default '{}',
  content bytea not null,
  size integer not null check (size between 1 and 10485760),
  enabled boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, template_id)
);
${policy('document_templates')}
grant select, insert, update, delete on ${s}.document_templates to ${options.appRole};

create table ${s}.generated_documents (
  organization_id text not null,
  document_id text not null,
  user_id text not null,
  template_id text,
  name text not null check (length(name) between 1 and 200),
  content_type text not null,
  content bytea not null,
  size integer not null check (size between 1 and 20971520),
  created_at timestamptz not null default now(),
  primary key (organization_id, document_id)
);
create index generated_documents_owner on ${s}.generated_documents (organization_id, user_id, created_at desc);
${policy('generated_documents')}
grant select, insert, delete on ${s}.generated_documents to ${options.appRole};
`;
}

export const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF = 'application/pdf';

export const templateInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
});

export interface DocumentTemplate {
  templateId: string;
  name: string;
  description: string | null;
  fields: string[];
  size: number;
  enabled: boolean;
  createdAt: string;
}

type TemplateRow = {
  template_id: string;
  name: string;
  description: string | null;
  fields: string[];
  size: number;
  enabled: boolean;
  created_at: Date;
};
const templateOf = (r: TemplateRow): DocumentTemplate => ({
  templateId: r.template_id,
  name: r.name,
  description: r.description,
  fields: r.fields,
  size: r.size,
  enabled: r.enabled,
  createdAt: r.created_at.toISOString(),
});
const TEMPLATE_COLUMNS = 'template_id, name, description, fields, size, enabled, created_at';

export async function insertTemplate(
  db: SqlExecutor,
  input: {
    organizationId: string;
    name: string;
    description?: string | undefined;
    fields: string[];
    content: Uint8Array;
    by: string;
  },
): Promise<DocumentTemplate> {
  const templateId = newId('dtpl');
  const { rows } = await db.query<TemplateRow>(
    `insert into document_templates
       (organization_id, template_id, name, description, fields, content, size, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${TEMPLATE_COLUMNS}`,
    [
      input.organizationId,
      templateId,
      input.name,
      input.description ?? null,
      input.fields,
      Buffer.from(input.content),
      input.content.byteLength,
      input.by,
    ],
  );
  return templateOf(rows[0] as TemplateRow);
}

/** The templates; only the enabled ones unless `all`. */
export async function listTemplates(
  db: SqlExecutor,
  options: { all?: boolean } = {},
): Promise<DocumentTemplate[]> {
  const { rows } = await db.query<TemplateRow>(
    `select ${TEMPLATE_COLUMNS} from document_templates where $1 or enabled order by name`,
    [options.all ?? false],
  );
  return rows.map(templateOf);
}

export async function readTemplate(
  db: SqlExecutor,
  templateId: string,
): Promise<(DocumentTemplate & { content: Uint8Array }) | null> {
  const { rows } = await db.query<TemplateRow & { content: Buffer }>(
    `select ${TEMPLATE_COLUMNS}, content from document_templates where template_id = $1`,
    [templateId],
  );
  const row = rows[0];
  return row ? { ...templateOf(row), content: new Uint8Array(row.content) } : null;
}

export async function updateTemplate(
  db: SqlExecutor,
  templateId: string,
  change: { name?: string; description?: string; enabled?: boolean },
): Promise<DocumentTemplate | null> {
  const { rows } = await db.query<TemplateRow>(
    `update document_templates set name = coalesce($2, name),
       description = coalesce($3, description), enabled = coalesce($4, enabled)
     where template_id = $1 returning ${TEMPLATE_COLUMNS}`,
    [templateId, change.name ?? null, change.description ?? null, change.enabled ?? null],
  );
  return rows[0] ? templateOf(rows[0]) : null;
}

export async function removeTemplate(db: SqlExecutor, templateId: string): Promise<boolean> {
  const { rows } = await db.query(
    `delete from document_templates where template_id = $1 returning template_id`,
    [templateId],
  );
  return rows.length > 0;
}

export interface GeneratedDocument {
  documentId: string;
  name: string;
  contentType: string;
  size: number;
  templateId: string | null;
  createdAt: string;
  /** Where the web downloads it. */
  href: string;
}

type GeneratedRow = {
  document_id: string;
  name: string;
  content_type: string;
  size: number;
  template_id: string | null;
  created_at: Date;
};
const generatedOf = (r: GeneratedRow): GeneratedDocument => ({
  documentId: r.document_id,
  name: r.name,
  contentType: r.content_type,
  size: r.size,
  templateId: r.template_id,
  createdAt: r.created_at.toISOString(),
  href: `/api/documents/${r.document_id}`,
});
const GENERATED_COLUMNS = 'document_id, name, content_type, size, template_id, created_at';

/** Keeps what a person produced, for her alone. */
export async function keepDocument(
  db: SqlExecutor,
  input: {
    organizationId: string;
    userId: string;
    templateId?: string | null;
    name: string;
    contentType: string;
    content: Uint8Array;
  },
): Promise<GeneratedDocument> {
  const { rows } = await db.query<GeneratedRow>(
    `insert into generated_documents
       (organization_id, document_id, user_id, template_id, name, content_type, content, size)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${GENERATED_COLUMNS}`,
    [
      input.organizationId,
      newId('gdoc'),
      input.userId,
      input.templateId ?? null,
      input.name.slice(0, 200),
      input.contentType,
      Buffer.from(input.content),
      input.content.byteLength,
    ],
  );
  return generatedOf(rows[0] as GeneratedRow);
}

/** Her documents, the latest first. */
export async function documentsOf(db: SqlExecutor, userId: string): Promise<GeneratedDocument[]> {
  const { rows } = await db.query<GeneratedRow>(
    `select ${GENERATED_COLUMNS} from generated_documents where user_id = $1
      order by created_at desc limit 100`,
    [userId],
  );
  return rows.map(generatedOf);
}

/** One of her documents, with its content; null when it is not hers. */
export async function readDocumentOf(
  db: SqlExecutor,
  documentId: string,
  userId: string,
): Promise<(GeneratedDocument & { content: Uint8Array }) | null> {
  const { rows } = await db.query<GeneratedRow & { content: Buffer }>(
    `select ${GENERATED_COLUMNS}, content from generated_documents
      where document_id = $1 and user_id = $2`,
    [documentId, userId],
  );
  const row = rows[0];
  return row ? { ...generatedOf(row), content: new Uint8Array(row.content) } : null;
}

export async function removeDocument(
  db: SqlExecutor,
  documentId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `delete from generated_documents where document_id = $1 and user_id = $2 returning document_id`,
    [documentId, userId],
  );
  return rows.length > 0;
}

/** A file name from a title: letters, digits, spaces and dashes, at most 120 characters. */
export function fileName(title: string, extension: 'docx' | 'pdf'): string {
  const base = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || 'document'}.${extension}`;
}
