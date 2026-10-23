import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { findParty } from '../parties/index.js';
import { findProject, type Project } from '../projects/index.js';

// Money by project (spec 076, doctrine D-049): the apps say their facts of money to the center —
// invoiced, received, committed, spent — each with its project and its budget post, in the shape
// of the contract `money-fact.v1` (kete-core). The center adds them up: what a project received,
// what it committed, what it spent, what is left of its funds — and whether its commitments are
// about to be paid with another project's money. It executes no payment and keeps no ledger: the
// app that said a fact owns it, and replaces it when it changes. Amounts are integers of the
// currency's smallest unit; every figure here is a sum, computed.

export function moneyMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.money_facts (
  organization_id text not null,
  -- The app that said it, and its own key: said again, the fact is replaced.
  source text not null check (length(source) between 1 and 80),
  key text not null check (length(key) between 1 and 200),
  kind text not null check (kind in ('invoiced', 'received', 'committed', 'spent')),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  occurred_on date not null,
  label text not null check (length(label) between 1 and 300),
  -- Its project; none for the organization's own running (« Fonctionnement »).
  project_id text,
  post text check (length(post) between 1 and 120),
  party_id text,
  href text check (length(href) <= 600),
  said_by text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, source, key),
  check (post is null or project_id is not null),
  foreign key (organization_id, project_id) references ${s}.projects (organization_id, project_id),
  foreign key (organization_id, party_id) references ${s}.parties (organization_id, party_id)
);
create index money_facts_project on ${s}.money_facts (organization_id, project_id, kind);
${organizationPolicySql({ schema: s, table: 'money_facts', appRole: options.appRole })}
grant select, insert, update, delete on ${s}.money_facts to ${options.appRole};
`;
}

export const factKinds = ['invoiced', 'received', 'committed', 'spent'] as const;
export type FactKind = (typeof factKinds)[number];

/** A fact of money, as the contract `money-fact.v1` writes it. */
export const moneyFactInput = z
  .object({
    key: z.string().min(1).max(200),
    kind: z.enum(factKinds),
    amount: z.number().int().min(0).refine(Number.isSafeInteger),
    currency: z.string().regex(/^[A-Z]{3}$/),
    occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().min(1).max(300),
    project_id: z
      .string()
      .regex(/^prj_[0-9a-f-]{8,64}$/)
      .optional(),
    post: z.string().min(1).max(120).optional(),
    party_id: z
      .string()
      .regex(/^pty_[0-9a-f-]{8,64}$/)
      .optional(),
    /** The object it is about: it inherits that object's axes (spec 100, kete-core spec 142). */
    object: z
      .object({
        kind: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
      })
      .strict()
      .optional(),
    href: z.url().max(600).optional(),
  })
  .strict();
export type MoneyFactInput = z.output<typeof moneyFactInput>;

export class MoneyRefusal extends Error {
  constructor(
    readonly code: 'unknown_project' | 'unknown_party' | 'unknown_post' | 'currency_mismatch',
  ) {
    super(code);
    this.name = 'MoneyRefusal';
  }
}

/**
 * An app says a fact of money. Its project must exist, and its post be one of the project's
 * budget; its third party is kept as the record that stays. Said again, the fact is replaced.
 */
export async function sayFact(
  db: SqlExecutor,
  organizationId: string,
  said: { source: string; by: string; fact: MoneyFactInput },
): Promise<void> {
  const { fact } = said;
  let project: Project | null = null;
  if (fact.project_id) {
    project = await findProject(db, fact.project_id);
    if (!project) throw new MoneyRefusal('unknown_project');
    // One currency per project: its sums would mean nothing otherwise.
    if (project.currency !== fact.currency) throw new MoneyRefusal('currency_mismatch');
    if (fact.post && !project.posts.some((post) => post.name === fact.post)) {
      throw new MoneyRefusal('unknown_post');
    }
  } else if (fact.post) {
    throw new MoneyRefusal('unknown_post');
  }
  const party = fact.party_id ? await findParty(db, fact.party_id) : null;
  if (fact.party_id && !party) throw new MoneyRefusal('unknown_party');
  await db.query(
    `insert into money_facts (organization_id, source, key, kind, amount, currency, occurred_on,
       label, project_id, post, party_id, href, said_by, object_kind, object_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (organization_id, source, key) do update
       set kind = excluded.kind, amount = excluded.amount, currency = excluded.currency,
           occurred_on = excluded.occurred_on, label = excluded.label,
           project_id = excluded.project_id, post = excluded.post, party_id = excluded.party_id,
           href = excluded.href, said_by = excluded.said_by, object_kind = excluded.object_kind,
           object_id = excluded.object_id, updated_at = now()`,
    [
      organizationId,
      said.source,
      fact.key,
      fact.kind,
      fact.amount,
      fact.currency,
      fact.occurred_on,
      fact.label,
      project?.projectId ?? null,
      fact.post ?? null,
      party?.partyId ?? null,
      fact.href ?? null,
      said.by,
      fact.object?.kind ?? null,
      fact.object?.id ?? null,
    ],
  );
}

/** An app takes a fact back: it was not true. */
export async function dropFact(
  db: SqlExecutor,
  fact: { source: string; key: string },
): Promise<boolean> {
  const { rows } = await db.query(
    'delete from money_facts where source = $1 and key = $2 returning key',
    [fact.source, fact.key],
  );
  return rows.length > 0;
}

export interface PostMoney {
  name: string;
  budget: number;
  committed: number;
  spent: number;
  /** Its budget less what was committed and spent: negative once it is exceeded. */
  left: number;
}

export interface ProjectMoney {
  projectId: string;
  currency: string;
  /** Asked of third parties and still due. */
  invoiced: number;
  received: number;
  /** Promised and still to pay. */
  committed: number;
  spent: number;
  /** Received less spent: what is left of its funds. Negative: it lives on other money. */
  available: number;
  /**
   * What its commitments exceed its available funds by: unless more comes in, they will be paid
   * with money received for something else. Zero when its funds cover them.
   */
  short: number;
  posts: PostMoney[];
  /** Spent and committed outside any post of its budget. */
  outsideBudget: number;
}

type Sum = { kind: FactKind; post: string | null; total: string };

/** A project's money, added up from the facts the apps said. */
export async function moneyOf(db: SqlExecutor, project: Project): Promise<ProjectMoney> {
  const { rows } = await db.query<Sum>(
    `select kind, post, sum(amount) as total from money_facts
      where project_id = $1 group by kind, post`,
    [project.projectId],
  );
  const total = (kind: FactKind, post?: string | null) =>
    rows
      .filter((row) => row.kind === kind && (post === undefined || row.post === post))
      .reduce((sum, row) => sum + Number(row.total), 0);
  const received = total('received');
  const spent = total('spent');
  const committed = total('committed');
  const available = received - spent;
  const posts = project.posts.map((post) => {
    const postCommitted = total('committed', post.name);
    const postSpent = total('spent', post.name);
    return {
      name: post.name,
      budget: post.budget,
      committed: postCommitted,
      spent: postSpent,
      left: post.budget - postCommitted - postSpent,
    };
  });
  return {
    projectId: project.projectId,
    currency: project.currency,
    invoiced: total('invoiced'),
    received,
    committed,
    spent,
    available,
    short: Math.max(0, committed - Math.max(0, available)) + Math.max(0, -available),
    posts,
    outsideBudget: total('committed', null) + total('spent', null),
  };
}

export interface MoneyLine {
  source: string;
  key: string;
  kind: FactKind;
  amount: number;
  occurredOn: string;
  label: string;
  post: string | null;
  party: string | null;
  href: string | null;
}

/** The facts behind a project's sums, the latest first: each figure has its pieces. */
export async function factsOf(db: SqlExecutor, projectId: string): Promise<MoneyLine[]> {
  const { rows } = await db.query<{
    source: string;
    key: string;
    kind: FactKind;
    amount: string;
    occurred_on: string;
    label: string;
    post: string | null;
    party: string | null;
    href: string | null;
  }>(
    // Days as text: a date read as a moment shifts with the server's time zone.
    `select f.source, f.key, f.kind, f.amount, f.occurred_on::text, f.label, f.post, f.href,
            p.name as party
       from money_facts f left join parties p on p.party_id = f.party_id
      where f.project_id = $1 order by f.occurred_on desc, f.updated_at desc limit 200`,
    [projectId],
  );
  return rows.map((row) => ({
    source: row.source,
    key: row.key,
    kind: row.kind,
    amount: Number(row.amount),
    occurredOn: row.occurred_on,
    label: row.label,
    post: row.post,
    party: row.party,
    href: row.href,
  }));
}

export interface OrganizationMoney {
  currency: string;
  /** What is left of the funds of every project: money that is not the organization's to spend. */
  reserved: number;
  /** Promised and still to pay, on projects and outside. */
  committed: number;
  /** Outside any project — the organization's own running. */
  running: { invoiced: number; received: number; committed: number; spent: number };
  /** Projects whose commitments exceed their funds: they are about to live on other money. */
  shortProjects: number;
}

/**
 * The organization's money as the facts tell it, in one currency: what is reserved for projects
 * and what is committed. What is in the bank is the treasury's to say (Kete Finance): the center only
 * knows what was said to it.
 */
export async function organizationMoney(
  db: SqlExecutor,
  currency: string,
  projects: readonly Project[],
): Promise<OrganizationMoney> {
  let reserved = 0;
  let shortProjects = 0;
  for (const project of projects) {
    if (project.currency !== currency || project.status === 'closed') continue;
    const money = await moneyOf(db, project);
    reserved += Math.max(0, money.available);
    if (money.short > 0) shortProjects += 1;
  }
  const { rows } = await db.query<{ kind: FactKind; inside: boolean; total: string }>(
    `select kind, project_id is not null as inside, sum(amount) as total from money_facts
      where currency = $1 group by kind, project_id is not null`,
    [currency],
  );
  const of = (kind: FactKind, inside?: boolean) =>
    rows
      .filter((row) => row.kind === kind && (inside === undefined || row.inside === inside))
      .reduce((sum, row) => sum + Number(row.total), 0);
  return {
    currency,
    reserved,
    committed: of('committed'),
    running: {
      invoiced: of('invoiced', false),
      received: of('received', false),
      committed: of('committed', false),
      spent: of('spent', false),
    },
    shortProjects,
  };
}
