import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';

// Forms (spec 032): simple collections — a few fields, answered by a link or by the people of the
// organization — whose answers may go through a circuit of the decisions engine, and are read as
// data: the same small query as a team's tables (spec 031b) sums them up.

export function formsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.form_collections (
  organization_id text not null,
  collection_id text not null,
  name text not null check (length(name) between 1 and 160),
  description text check (length(description) <= 2000),
  fields jsonb not null,
  answered_by text not null check (answered_by in ('link', 'everyone')),
  measure_field text,
  open boolean not null default true,
  owner_id text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, collection_id)
);
${policy('form_collections')}
grant select, insert, update, delete on ${s}.form_collections to ${options.appRole};

create table ${s}.form_submissions (
  organization_id text not null,
  submission_id text not null,
  collection_id text not null,
  answer_values jsonb not null,
  submitted_by text,
  submitter_name text check (length(submitter_name) <= 200),
  status text not null check (status in ('received', 'pending', 'approved', 'refused')),
  request_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  primary key (organization_id, submission_id),
  foreign key (organization_id, collection_id)
    references ${s}.form_collections (organization_id, collection_id) on delete cascade
);
create index form_submissions_collection on ${s}.form_submissions (organization_id, collection_id, created_at);
${policy('form_submissions')}
grant select, insert, update on ${s}.form_submissions to ${options.appRole};
`;
}

/** A field: a short text, a long text, a number, a day, one choice among options, a yes or no. */
export const field = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().trim().min(1).max(300),
    type: z.enum(['text', 'long_text', 'number', 'date', 'choice', 'yes_no']),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(30).optional(),
  })
  .refine((f) => f.type !== 'choice' || (f.options?.length ?? 0) >= 2, 'A choice needs options.');
export type Field = z.infer<typeof field>;

export const collectionInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    fields: z.array(field).min(1).max(40),
    answeredBy: z.enum(['link', 'everyone']).default('everyone'),
    /** The number field a circuit's thresholds read (an amount, a number of days). */
    measureField: z.string().max(40).optional(),
  })
  .refine((c) => new Set(c.fields.map((f) => f.key)).size === c.fields.length, {
    message: 'Two fields share a key.',
  })
  .refine(
    (c) => !c.measureField || c.fields.some((f) => f.key === c.measureField && f.type === 'number'),
    { message: 'The measure is one of its number fields.' },
  );

export type Value = string | number | boolean | null;

export class FormError extends Error {
  constructor(
    readonly code: 'invalid_answer' | 'closed',
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'FormError';
  }
}

/** The answers checked against the fields: each typed, the required present, nothing else kept. */
export function checkAnswers(fields: Field[], raw: Record<string, unknown>): Record<string, Value> {
  const problems: string[] = [];
  const values: Record<string, Value> = {};
  for (const f of fields) {
    const v = raw[f.key];
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (f.required) problems.push(`${f.key}: required`);
      values[f.key] = null;
      continue;
    }
    switch (f.type) {
      case 'text':
      case 'long_text': {
        const max = f.type === 'text' ? 300 : 5000;
        if (typeof v !== 'string' || v.length > max) problems.push(`${f.key}: text`);
        else values[f.key] = v.trim();
        break;
      }
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n)) problems.push(`${f.key}: number`);
        else values[f.key] = n;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
          problems.push(`${f.key}: date`);
        else values[f.key] = v;
        break;
      case 'choice':
        if (typeof v !== 'string' || !f.options?.includes(v)) problems.push(`${f.key}: choice`);
        else values[f.key] = v;
        break;
      case 'yes_no':
        if (typeof v !== 'boolean') problems.push(`${f.key}: yes or no`);
        else values[f.key] = v;
        break;
    }
  }
  if (problems.length) throw new FormError('invalid_answer', problems.join('; '), problems);
  return values;
}

export interface Collection {
  collectionId: string;
  name: string;
  description: string | null;
  fields: Field[];
  answeredBy: 'link' | 'everyone';
  measureField: string | null;
  open: boolean;
  ownerId: string;
  createdAt: string;
  /** Its circuit's subject: `forms.<id>`. */
  subject: string;
}

type CollectionRow = {
  collection_id: string;
  name: string;
  description: string | null;
  fields: Field[];
  answered_by: 'link' | 'everyone';
  measure_field: string | null;
  open: boolean;
  owner_id: string;
  created_at: Date;
};

/** A collection's subject in the decisions engine: `forms.c<its id, letters and digits>`. */
export const subjectOf = (collectionId: string) =>
  `forms.c${collectionId
    .replace(/^frm_/, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40)}`;

const collectionOf = (r: CollectionRow): Collection => ({
  collectionId: r.collection_id,
  name: r.name,
  description: r.description,
  fields: r.fields,
  answeredBy: r.answered_by,
  measureField: r.measure_field,
  open: r.open,
  ownerId: r.owner_id,
  createdAt: r.created_at.toISOString(),
  subject: subjectOf(r.collection_id),
});
const COLUMNS = `collection_id, name, description, fields, answered_by, measure_field, open,
  owner_id, created_at`;

export async function createCollection(
  db: SqlExecutor,
  organizationId: string,
  ownerId: string,
  input: z.infer<typeof collectionInput>,
): Promise<Collection> {
  const collectionId = newId('frm');
  const { rows } = await db.query<CollectionRow>(
    `insert into form_collections (organization_id, collection_id, name, description, fields,
       answered_by, measure_field, owner_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
    [
      organizationId,
      collectionId,
      input.name,
      input.description ?? null,
      JSON.stringify(input.fields),
      input.answeredBy,
      input.measureField ?? null,
      ownerId,
    ],
  );
  return collectionOf(rows[0] as CollectionRow);
}

export async function getCollection(
  db: SqlExecutor,
  collectionId: string,
): Promise<Collection | null> {
  const { rows } = await db.query<CollectionRow>(
    `select ${COLUMNS} from form_collections where collection_id = $1`,
    [collectionId],
  );
  return rows[0] ? collectionOf(rows[0]) : null;
}

/** All the collections; the answers counted for each. */
export async function listCollections(
  db: SqlExecutor,
): Promise<(Collection & { submissions: number })[]> {
  const { rows } = await db.query<CollectionRow & { submissions: number }>(
    `select ${COLUMNS},
       (select count(*)::int from form_submissions s where s.collection_id = c.collection_id) as submissions
       from form_collections c order by created_at desc`,
  );
  return rows.map((r) => ({ ...collectionOf(r), submissions: r.submissions }));
}

export async function setOpen(db: SqlExecutor, collectionId: string, open: boolean) {
  await db.query(`update form_collections set open = $2 where collection_id = $1`, [
    collectionId,
    open,
  ]);
}

/** The collection whose subject this is (a circuit's request names it). */
export async function collectionOfSubject(
  db: SqlExecutor,
  subject: string,
): Promise<Collection | null> {
  const all = await listCollections(db);
  return all.find((c) => c.subject === subject) ?? null;
}

export interface Submission {
  submissionId: string;
  values: Record<string, Value>;
  submittedBy: string | null;
  submitterName: string | null;
  status: 'received' | 'pending' | 'approved' | 'refused';
  requestId: string | null;
  createdAt: string;
}

export async function insertSubmission(
  db: SqlExecutor,
  input: {
    organizationId: string;
    collectionId: string;
    values: Record<string, Value>;
    submittedBy: string | null;
    submitterName: string | null;
  },
): Promise<string> {
  const submissionId = newId('fsb');
  await db.query(
    `insert into form_submissions (organization_id, submission_id, collection_id, answer_values,
       submitted_by, submitter_name, status)
     values ($1, $2, $3, $4, $5, $6, 'received')`,
    [
      input.organizationId,
      submissionId,
      input.collectionId,
      JSON.stringify(input.values),
      input.submittedBy,
      input.submitterName,
    ],
  );
  return submissionId;
}

export async function setSubmissionStatus(
  db: SqlExecutor,
  submissionId: string,
  status: Submission['status'],
  requestId?: string,
) {
  await db.query(
    `update form_submissions set status = $2, request_id = coalesce($3, request_id),
       decided_at = case when $2 in ('approved', 'refused') then now() else decided_at end
     where submission_id = $1`,
    [submissionId, status, requestId ?? null],
  );
}

export async function submissionsOf(
  db: SqlExecutor,
  collectionId: string,
  options: { submittedBy?: string; limit?: number } = {},
): Promise<Submission[]> {
  const { rows } = await db.query<{
    submission_id: string;
    answer_values: Record<string, Value>;
    submitted_by: string | null;
    submitter_name: string | null;
    status: Submission['status'];
    request_id: string | null;
    created_at: Date;
  }>(
    `select submission_id, answer_values, submitted_by, submitter_name, status, request_id, created_at
       from form_submissions
      where collection_id = $1 and ($2::text is null or submitted_by = $2)
      order by created_at desc limit $3`,
    [collectionId, options.submittedBy ?? null, options.limit ?? 50_000],
  );
  return rows.map((r) => ({
    submissionId: r.submission_id,
    values: r.answer_values,
    submittedBy: r.submitted_by,
    submitterName: r.submitter_name,
    status: r.status,
    requestId: r.request_id,
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * The answers as rows of data (spec 031b): one column per field (a number, a day or a text), and
 * the answer's day and status — so the same query sums them up. A yes or no is 1 or 0.
 */
export function asData(collection: Collection, submissions: Submission[]) {
  const columns = [
    { name: 'answered_on', type: 'date' as const },
    { name: 'status', type: 'text' as const },
    ...collection.fields.map((f) => ({
      name: f.key,
      // A yes or no is 1 or 0: its sum counts the yes, its average their share.
      type:
        f.type === 'number' || f.type === 'yes_no'
          ? ('number' as const)
          : f.type === 'date'
            ? ('date' as const)
            : ('text' as const),
    })),
  ];
  const rows = submissions.map((s) => ({
    answered_on: s.createdAt.slice(0, 10),
    status: s.status,
    ...Object.fromEntries(
      collection.fields.map((f) => {
        const v = s.values[f.key];
        return [f.key, typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null)];
      }),
    ),
  }));
  return { columns, rows };
}
