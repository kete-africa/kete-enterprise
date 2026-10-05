import { ask, extract } from '@kete/ai';
import type { CapabilityTool } from '@kete/capabilities';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono } from 'hono';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { organizationLanguageModel } from '../../platform/models.js';
import { usageStore } from '../../platform/usage.js';
import { requestFor } from '../decisions/index.js';
import { toolsForPerson } from '../gateway/index.js';
import { knowledgeTool, libraryOpen } from '../knowledge/index.js';
import { notificationWords, tell } from '../notifications/index.js';
import { personOfAccount } from '../structure/index.js';

// « À faire » (spec 047): what the master-detail adds to a decision — the assistant's analysis,
// sourced, for the person who decides; the discussion of the people it concerns. An analysis reads
// with her rights and never prepares nor commits anything: she decides.

type Identity = IdentityVariables['identity'];

export function todoMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.decision_analyses (
  organization_id text not null,
  request_id text not null,
  user_id text not null,
  recommendation text not null check (recommendation in ('approve', 'refuse', 'unsure')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  points jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id, user_id),
  foreign key (organization_id, request_id)
    references ${s}.decision_requests (organization_id, request_id)
);
${organizationPolicySql({ schema: s, table: 'decision_analyses', appRole: options.appRole })}
grant select, insert, update on ${s}.decision_analyses to ${options.appRole};

create table ${s}.decision_comments (
  organization_id text not null,
  comment_id text not null,
  request_id text not null,
  author_id text not null,
  author_name text not null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  primary key (organization_id, comment_id),
  foreign key (organization_id, request_id)
    references ${s}.decision_requests (organization_id, request_id)
);
create index decision_comments_request on ${s}.decision_comments (organization_id, request_id, created_at);
${organizationPolicySql({ schema: s, table: 'decision_comments', appRole: options.appRole })}
grant select, insert on ${s}.decision_comments to ${options.appRole};
`;
}

/** Where a point comes from: a passage the tools returned, linked when it has an address. */
export interface Source {
  title: string;
  href: string | null;
}

export interface Analysis {
  recommendation: 'approve' | 'refuse' | 'unsure';
  confidence: 'high' | 'medium' | 'low';
  /** Each point with its source when one the tools returned backs it. */
  points: { text: string; source: Source | null }[];
  createdAt: string;
}

export interface Comment {
  commentId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

const analysisSchema = z.object({
  recommendation: z.enum(['approve', 'refuse', 'unsure']),
  confidence: z.enum(['high', 'medium', 'low']),
  points: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        source: z.number().int().min(1).nullable(),
      }),
    )
    .min(1)
    .max(6),
});

let modelOverride: LanguageModel | null | undefined;

/** Tests: analyse with another model (`null`: as if none were configured). */
export function useAnalysisModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

/** The sources a tool returned: the library's passages, with their titles and addresses. */
function sourcesOf(output: unknown): Source[] {
  const passages = (output as { output?: { passages?: unknown } } | null)?.output?.passages;
  if (!Array.isArray(passages)) return [];
  return passages.flatMap((p) => {
    const { title, href } = (p ?? {}) as { title?: unknown; href?: unknown };
    return typeof title === 'string'
      ? [{ title, href: typeof href === 'string' ? href : null }]
      : [];
  });
}

type Read = NonNullable<Awaited<ReturnType<typeof requestFor>>>;

async function readable(db: SqlExecutor, identity: Identity, requestId: string): Promise<Read> {
  const read = await requestFor(db, identity, requestId);
  if (!read) throw new GestureRefusal(404, 'not_found', 'No such request for her.');
  return read;
}

function described(read: Read, requester: string): string {
  const r = read.request;
  return [
    `Décision demandée : ${r.title}`,
    `Sujet : ${r.subjectLabel?.fr ?? r.subject} · référence ${r.reference}`,
    r.measure !== null ? `Montant ou mesure : ${r.measure}` : null,
    `Demandée par ${requester} le ${r.createdAt.slice(0, 10)}`,
    `Étape en cours : ${r.currentStep ?? '—'} sur ${r.steps.length}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The analysis of a request for the person who reads it: the assistant gathers with her read-only
 * tools — the company's library, the apps' and the registers' readings — then answers in a fixed
 * form: approve, refuse or unsure, how sure, and the points that weigh, each with its source.
 */
export async function analyse(identity: Identity, requestId: string): Promise<Analysis> {
  const { organizationId, userId } = identity;
  const { read, requester, library } = await transaction(organizationId, async (db) => {
    const read = await readable(db, identity, requestId);
    const person = await personOfAccount(db, read.request.requesterUserId);
    return {
      read,
      requester: person?.name ?? read.request.requesterUserId,
      library: await libraryOpen(db, identity),
    };
  });
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) throw new GestureRefusal(409, 'assistant_unavailable', 'No model configured.');
  const actor = {
    kind: 'agent' as const,
    id: 'agt_assistant',
    channel: 'web' as const,
    onBehalfOf: { kind: 'person' as const, id: userId },
  };
  const metering = (purpose: string) => ({
    store: usageStore(),
    context: { organizationId, actor, purpose, model: '' },
  });
  const case_ = described(read, requester);
  const gathered = await asPerson(identity, async () => {
    // Reading only: an analysis never prepares a draft nor commits anything.
    const tools: CapabilityTool[] = [
      ...(await toolsForPerson(identity)).filter((t) => t.autonomy <= 1),
      ...(library ? [knowledgeTool(identity)] : []),
    ];
    return ask({
      model,
      system:
        'Tu prépares l’analyse d’une décision pour la personne qui doit la prendre. Cherche avec ' +
        'tes outils ce qui l’éclaire : documents, devis, contrats, procédures, budgets, historique. ' +
        'Tu ne prépares ni n’engages rien. Rends les faits utiles, chacun avec le titre exact de sa ' +
        'source.',
      prompt: case_,
      tools,
      maxSteps: 6,
      metering: metering('decision-analysis'),
    });
  });
  const sources = gathered.toolResults.flatMap((r) => sourcesOf(r.output));
  const { value } = await extract({
    model,
    schema: analysisSchema,
    system:
      'Tu rends l’analyse d’une décision : recommander d’approuver, de refuser, ou dire que tu ne ' +
      'sais pas ; ta confiance ; de un à six points courts qui pèsent, en français. Un point ne ' +
      'cite une source que si elle figure dans la liste, par son numéro ; sinon null. N’invente rien.',
    prompt:
      `${case_}\n\nCe que les outils ont rassemblé :\n${gathered.text || '(rien)'}\n\n` +
      `Sources :\n${sources.map((s, i) => `[${i + 1}] ${s.title}`).join('\n') || '(aucune)'}`,
    metering: metering('decision-analysis'),
  });
  const points = value.points.map((p) => ({
    text: p.text,
    source: p.source !== null ? (sources[p.source - 1] ?? null) : null,
  }));
  const analysis: Analysis = {
    recommendation: value.recommendation,
    // Without a single verified source, the assistant is not highly sure.
    confidence:
      value.confidence === 'high' && !points.some((p) => p.source !== null)
        ? 'medium'
        : value.confidence,
    points,
    createdAt: new Date().toISOString(),
  };
  await transaction(organizationId, (db) =>
    db.query(
      `insert into decision_analyses
         (organization_id, request_id, user_id, recommendation, confidence, points)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (organization_id, request_id, user_id) do update
         set recommendation = excluded.recommendation, confidence = excluded.confidence,
             points = excluded.points, created_at = now()`,
      [
        organizationId,
        requestId,
        userId,
        analysis.recommendation,
        analysis.confidence,
        JSON.stringify(analysis.points),
      ],
    ),
  );
  return analysis;
}

async function analysisOf(
  db: SqlExecutor,
  requestId: string,
  userId: string,
): Promise<Analysis | null> {
  const { rows } = await db.query<{
    recommendation: Analysis['recommendation'];
    confidence: Analysis['confidence'];
    points: Analysis['points'];
    created_at: Date;
  }>(
    `select recommendation, confidence, points, created_at from decision_analyses
      where request_id = $1 and user_id = $2`,
    [requestId, userId],
  );
  const r = rows[0];
  return r
    ? {
        recommendation: r.recommendation,
        confidence: r.confidence,
        points: r.points,
        createdAt: r.created_at.toISOString(),
      }
    : null;
}

async function commentsOf(db: SqlExecutor, requestId: string): Promise<Comment[]> {
  const { rows } = await db.query<{
    comment_id: string;
    author_id: string;
    author_name: string;
    body: string;
    created_at: Date;
  }>(
    `select comment_id, author_id, author_name, body, created_at from decision_comments
      where request_id = $1 order by created_at`,
    [requestId],
  );
  return rows.map((r) => ({
    commentId: r.comment_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at.toISOString(),
  }));
}

/** « À faire »'s own routes, under /v1/todo (spec 047). */
export const todoRoutes = new Hono<{ Variables: IdentityVariables }>()
  // A request in full for whoever it concerns: its steps, its analysis for her, its discussion.
  .get('/decisions/:requestId', async (c) => {
    const identity = c.get('identity');
    const requestId = c.req.param('requestId');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const read = await readable(db, identity, requestId);
        const requester = await personOfAccount(db, read.request.requesterUserId);
        return {
          request: read.request,
          mayDecide: read.mayDecide && !c.get('viewedBy'),
          requesterName: requester?.name ?? null,
          analysis: await analysisOf(db, requestId, identity.userId),
          comments: await commentsOf(db, requestId),
        };
      }),
    );
  })
  .post('/decisions/:requestId/analysis', async (c) => {
    const identity = c.get('identity');
    return c.json({ analysis: await analyse(identity, c.req.param('requestId')) });
  })
  // A word in the discussion: whoever the request concerns; its requester and the others who
  // wrote are told.
  .post('/decisions/:requestId/comments', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to write.');
    const parsed = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A message.');
    const identity = c.get('identity');
    const requestId = c.req.param('requestId');
    const comment = await transaction(identity.organizationId, async (db) => {
      const read = await readable(db, identity, requestId);
      const author = (await personOfAccount(db, identity.userId))?.name ?? identity.name;
      const comment: Comment = {
        commentId: newId('dcm'),
        authorId: identity.userId,
        authorName: author,
        body: parsed.data.body,
        createdAt: new Date().toISOString(),
      };
      await db.query(
        `insert into decision_comments
           (organization_id, comment_id, request_id, author_id, author_name, body)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          identity.organizationId,
          comment.commentId,
          requestId,
          comment.authorId,
          comment.authorName,
          comment.body,
        ],
      );
      const others = new Set([
        read.request.requesterUserId,
        ...(await commentsOf(db, requestId)).map((x) => x.authorId),
      ]);
      others.delete(identity.userId);
      for (const userId of others) {
        await tell(db, identity.organizationId, userId, {
          kind: 'decision.comment',
          title: notificationWords().decisionComment(author, read.request.title),
          href: `/a-faire?item=decision:${requestId}`,
        });
      }
      return comment;
    });
    return c.json({ comment }, 201);
  });
