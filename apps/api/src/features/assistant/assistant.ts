import {
  aiMigrationSql,
  ask,
  askStream,
  BudgetExceededError,
  extract,
  languageModel,
  modelConfigFromEnv,
  type ModelConfig,
} from '@kete/ai';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { secretsOn } from '../../platform/secrets.js';
import { usageStore } from '../../platform/usage.js';
import {
  markSubscriptionUsed,
  modelChoiceFor,
  payers,
  payersFor,
  readSubscription,
  subscriptionAgent,
  SubscriptionLostError,
  type Payer,
} from '../ai/index.js';
import { colleagueCard } from '../directory/index.js';
import { dashboardsOpen, dashboardTools } from '../dashboards/index.js';
import { datasetsOpen, datasetTools } from '../datasets/index.js';
import { documentsOpen, documentTools } from '../documents/index.js';
import { formsOpen, formTools } from '../forms/index.js';
import { knowledgeTool, libraryOpen } from '../knowledge/index.js';
import { keepSkill, skillsForModel, skillsOf } from '../skills/index.js';
import { skillFromText, SkillError } from '@kete/skills';
import { appToolsFor, decideDraft, draftsFor, toolsForPerson } from '../gateway/index.js';
import { readModules } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import { personOfAccount } from '../structure/index.js';
import { factsFor, type Facts } from '../workspace/index.js';
import {
  appendMessage,
  explainDraft,
  type AppView,
  listConversations,
  readConversation,
  startConversation,
  type ToolUse,
} from './conversations.js';
import {
  AttachmentError,
  MAX_ATTACHMENT_BYTES,
  saveAttachment,
  takeAttachments,
} from './attachments.js';
import {
  canvasTool,
  commandInstructions,
  readDirectives,
  scheduleTool,
  sourcesOf,
  type Source,
} from './chat-tools.js';
import { colleagueTool } from '../exchanges/index.js';
import { notesPromptFor } from '../notes/index.js';
import { listMemories, memoryPrompt, rememberTool, type Memory } from './memory.js';
import { assistantWords } from './words.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/**
 * The assistant's tables (spec 014): the AI usage journal and budgets of @kete/ai, and the morning
 * briefings — one per person and day — each with its row-level security in the same migration.
 */
export function assistantMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
${aiMigrationSql({ schema: s, appRole: options.appRole })}

create table ${s}.briefings (
  organization_id text not null,
  person_id text not null,
  day date not null,
  text text not null,
  generated_by text not null check (generated_by in ('model', 'rules')),
  created_at timestamptz not null default now(),
  primary key (organization_id, person_id, day),
  foreign key (organization_id, person_id) references ${s}.people (organization_id, person_id)
);
${organizationPolicySql({ schema: s, table: 'briefings', appRole: options.appRole })}
grant select, insert, update on ${s}.briefings to ${options.appRole};
`;
}

/** The model, as the instance's environment names it (`KETE_AI_PROVIDER`, `KETE_AI_MODEL`). */
function configured(): ModelConfig | null {
  try {
    return modelConfigFromEnv('KETE_AI');
  } catch {
    return null;
  }
}

let store: ReturnType<typeof usageStore> | undefined;
const budgets = () => (store ??= usageStore());

type Model = Parameters<typeof ask>[0]['model'];
let override: Model | undefined;

/** Tests: answer with another model. */
export function useModel(model: Model | undefined): void {
  override = model;
}

/**
 * The model answering a person, and who pays (spec 026): her own connection when the
 * organization allows it and she brought one, else the organization's model.
 */
export async function modelFor(identity: {
  organizationId: string;
  userId: string;
}): Promise<{ model: Model; personal: boolean } | null> {
  if (override) return { model: override, personal: false };
  const choice = await transaction(identity.organizationId, (db) =>
    modelChoiceFor(db, identity.userId, configured()),
  );
  return choice ? { model: languageModel(choice.config), personal: choice.personal } : null;
}

/** Who may pay for her answers (spec 026b): the organization, her key, her subscription. */
const payersOf = (db: SqlExecutor, userId: string) =>
  payersFor(db, userId, {
    organizationModel: Boolean(override ?? configured()),
    keys: secretsOn(),
    subscriptions: subscriptionAgent().available(),
  });

/** What answers her in the chat: a model (hers or the organization's), or her own subscription. */
type Answerer =
  { kind: 'model'; model: Model; personal: boolean } | { kind: 'subscription'; machineId: string };

/**
 * The answerer she chose with « Pay with », if the organization's policy lets that payer pay — or
 * the first one allowed when she did not choose.
 */
async function answererFor(
  identity: { organizationId: string; userId: string },
  wanted: Payer | undefined,
): Promise<Answerer> {
  return transaction(identity.organizationId, async (db) => {
    const allowed = await payersOf(db, identity.userId);
    const payer = wanted ?? allowed[0];
    if (!payer || !allowed.includes(payer)) {
      throw wanted
        ? new GestureRefusal(409, 'payer_refused', 'This payer cannot pay for her answers.')
        : new GestureRefusal(409, 'assistant_unavailable', 'No model is configured here.');
    }
    if (payer === 'subscription') {
      const own = await readSubscription(db, identity.userId);
      return { kind: 'subscription', machineId: (own as { machineId: string }).machineId };
    }
    if (override) return { kind: 'model', model: override, personal: false };
    const choice = await modelChoiceFor(db, identity.userId, configured(), payer);
    if (!choice) {
      throw new GestureRefusal(409, 'assistant_unavailable', 'No model is configured here.');
    }
    return { kind: 'model', model: languageModel(choice.config), personal: choice.personal };
  });
}

/**
 * What her subscription reads: the same frame as the assistant's, without Kete Enterprise's tools —
 * it answers from what she gives it, and runs nothing.
 */
function subscriptionPrompt(
  organization: string,
  name: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  message: string,
  memories: Memory[] = [],
): string {
  return [
    system(organization, name) + memoryPrompt(memories),
    'Ici, tu réponds avec son propre abonnement, sans les outils de Kete Enterprise : appuie-toi seulement sur ce qu’elle te donne, et ne lance aucune commande.',
    ...history.map((m) => `${m.role === 'user' ? 'Elle' : 'Toi'} : ${m.content}`),
    `Elle : ${message}`,
  ].join('\n\n');
}

/** Her own tokens are journaled, never counted against the organization's budget (spec 026). */
export function meteringStore(personal: boolean) {
  const store = budgets();
  return personal ? { ...store, check: async () => undefined } : store;
}

/** What the usage journal says the call was for, and on whose tokens. */
export const purposeOf = (purpose: string, personal: boolean) =>
  personal ? `${purpose}:personal` : purpose;

export const system = (organization: string, name: string) =>
  [
    `Tu es l'assistant de ${name} dans Kete Enterprise, chez ${organization}.`,
    'Tu agis pour elle, avec ses droits et jamais plus : tes outils ne te montrent que ce qu’elle peut voir.',
    'Tu prépares, tu expliques, tu proposes ; tu ne décides jamais à sa place. Une décision, une signature ou une validation se font dans Kete Enterprise, par elle.',
    'Tu n’as aucune donnée de paie ni de salaire, et tu ne les inventes pas.',
    'Quand tu t’appuies sur un outil, dis d’où vient l’information (par exemple : « d’après vos actions ouvertes »).',
    'Avant d’utiliser des outils, annonce ton plan en une phrase courte (« Je lis vos tickets ouverts, puis le planning du terrain. »), puis agis : elle voit chaque étape.',
    'Pour créer une action ou une mesure, utilise l’outil qui en prépare le brouillon : elle le valide, toi jamais.',
    'Réponds en français, brièvement, en Markdown (listes courtes, tableaux quand c’est utile).',
  ].join('\n');

export async function organizationName(db: SqlExecutor): Promise<string> {
  const { rows } = await db.query<{ name: string }>(
    `select name from units where parent_id is null order by created_at limit 1`,
  );
  return rows[0]?.name ?? 'votre organisation';
}

const chatInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

/**
 * The morning briefing written from the facts, with no model: the rules' version, used when no
 * model is configured or when one fails. The same facts, in plain sentences.
 */
export function briefingByRules(facts: Facts): string {
  const w = assistantWords('fr');
  const lines: string[] = [w.hello(facts.name)];
  const overdue = facts.actions.filter((a) => a.overdue);
  if (facts.decisions.length) lines.push(w.decisions(facts.decisions.length));
  if (overdue.length) lines.push(w.overdue(overdue.length, overdue[0]?.title ?? ''));
  if (facts.forms.length) lines.push(w.forms(facts.forms.length, facts.forms[0]?.closesOn ?? ''));
  if (facts.notes.length) lines.push(w.notes(facts.notes.length));
  for (const review of facts.performance) {
    if (review.reds.length)
      lines.push(w.reds(review.reds.length, review.reds.slice(0, 3).join(', ')));
  }
  const teamReds = facts.team.filter((t) => t.reds > 0);
  if (teamReds.length) lines.push(w.team(teamReds.length));
  const toWrite = facts.team.filter((t) => t.status === 'measured').length;
  if (toWrite) lines.push(w.toWrite(toWrite));
  for (const news of facts.appNews.slice(0, 3)) {
    lines.push(w.appNews(news.app, news.count, news.description));
  }
  if (lines.length === 1) lines.push(w.nothing);
  return lines.join('\n');
}

export async function writeBriefing(identity: IdentityVariables['identity'], force: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  const { organizationId } = identity;
  const { person, facts, existing, organization } = await transaction(
    organizationId,
    async (db) => {
      const found = await personOfAccount(db, identity.userId);
      const stored = found
        ? (
            await db.query<{ text: string; generated_by: string; created_at: Date }>(
              `select text, generated_by, created_at from briefings where person_id = $1 and day = $2`,
              [found.personId, today],
            )
          ).rows[0]
        : undefined;
      return {
        person: found,
        facts: await factsFor(db, identity),
        existing: stored,
        organization: await organizationName(db),
      };
    },
  );
  if (existing && !force) {
    return {
      text: existing.text,
      generatedBy: existing.generated_by,
      at: existing.created_at,
      facts,
    };
  }
  let text = briefingByRules(facts);
  let generatedBy: 'model' | 'rules' = 'rules';
  const choice = await modelFor(identity);
  if (choice) {
    try {
      const answer = await ask({
        model: choice.model,
        system: `${system(organization, facts.name)}\nTu écris son briefing du matin : cinq à huit lignes, les urgences d'abord (en retard, à décider, échéances proches), puis où elle en est. Pas de titre, pas de formule creuse.`,
        prompt: `Voici les faits du jour, lus dans ses registres (JSON) :\n${JSON.stringify({ ...facts, apps: undefined })}`,
        maxSteps: 1,
        metering: {
          store: meteringStore(choice.personal),
          context: {
            organizationId,
            actor: {
              kind: 'agent',
              id: 'agt_briefing',
              channel: 'worker',
              onBehalfOf: { kind: 'person', id: identity.userId },
            },
            purpose: purposeOf('briefing', choice.personal),
            model: '',
          },
        },
      });
      if (answer.text.trim()) {
        text = answer.text.trim();
        generatedBy = 'model';
      }
    } catch (error) {
      if (!(error instanceof BudgetExceededError))
        console.error('[briefing]', (error as Error).message);
    }
  }
  if (person) {
    await transaction(organizationId, (db) =>
      db.query(
        `insert into briefings (organization_id, person_id, day, text, generated_by)
         values ($1, $2, $3, $4, $5)
         on conflict (organization_id, person_id, day)
         do update set text = $4, generated_by = $5, created_at = now()`,
        [organizationId, person.personId, today, text, generatedBy],
      ),
    );
  }
  return { text, generatedBy, at: new Date(), facts };
}

/** The assistant's routes, under /v1/assistant (spec 014). */
/** What the model writes to keep a skill from a conversation. */
const skillDraft = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(64)
    .describe('Le nom, en minuscules et tirets, par exemple « relance-client »'),
  description: z
    .string()
    .min(20)
    .max(1000)
    .describe('Ce que fait la compétence, et quand l’utiliser'),
  instructions: z.string().min(20).max(20_000).describe('Les étapes, en Markdown'),
});

export const assistantRoutes = new Hono<{ Variables: IdentityVariables }>()
  // Whether a model answers this person: her own connection, or the organization's (spec 026); and
  // who may pay for her answers, the first by default (spec 026b).
  .get('/', async (c) => {
    const identity = c.get('identity');
    const { choice, payers } = await transaction(identity.organizationId, async (db) => ({
      choice: override ? null : await modelChoiceFor(db, identity.userId, configured()),
      payers: await payersOf(db, identity.userId),
    }));
    return c.json({
      available: Boolean(override ?? choice) || payers.includes('subscription'),
      provider: choice?.config.provider ?? null,
      model: choice?.config.model ?? null,
      personal: choice?.personal ?? false,
      payers,
    });
  })
  .get('/briefing', async (c) => c.json(await writeBriefing(c.get('identity'), false)))
  .post('/briefing', async (c) => c.json(await writeBriefing(c.get('identity'), true), 201))
  .post('/chat', async (c: Ctx) => {
    const identity = c.get('identity');
    const choice = await modelFor(identity);
    if (!choice) {
      throw new GestureRefusal(409, 'assistant_unavailable', 'No model is configured here.');
    }
    const parsed = chatInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'The conversation is not valid.');
    // Seen « as » a demo person, the assistant is hers: the same rights, the same tools.
    const organization = await transaction(identity.organizationId, organizationName);
    try {
      const answer = await asPerson(identity, async () =>
        ask({
          model: choice.model,
          system: system(organization, identity.name),
          messages: parsed.data.messages,
          tools: await toolsForPerson(identity),
          maxSteps: 6,
          metering: {
            store: meteringStore(choice.personal),
            context: {
              organizationId: identity.organizationId,
              actor: {
                kind: 'agent',
                id: 'agt_assistant',
                channel: 'chat',
                onBehalfOf: { kind: 'person', id: identity.userId },
              },
              purpose: purposeOf('chat', choice.personal),
              model: '',
            },
          },
        }),
      );
      return c.json({ text: answer.text, tools: answer.toolResults.map((r) => r.name) });
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        throw new GestureRefusal(409, 'budget_spent', error.message);
      }
      throw error;
    }
  })
  // The conversations of the person, as in any assistant (spec 017).
  .get('/conversations', async (c) => {
    const identity = c.get('identity');
    return c.json({
      conversations: await transaction(identity.organizationId, (db) =>
        listConversations(db, identity.userId),
      ),
    });
  })
  .get('/conversations/:conversationId', async (c) => {
    const identity = c.get('identity');
    const found = await transaction(identity.organizationId, (db) =>
      readConversation(db, identity.userId, c.req.param('conversationId')),
    );
    if (!found) throw new GestureRefusal(404, 'not_found', 'No such conversation.');
    return c.json(found);
  })
  // A skill kept from a conversation (spec 031): the model writes its SKILL.md from what worked;
  // it is hers alone until an administrator opens it to others.
  .post('/conversations/:conversationId/skill', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to keep.');
    const identity = c.get('identity');
    const conversation = await transaction(identity.organizationId, async (db) => {
      if (!(await readModules(db)).skills) {
        throw new GestureRefusal(403, 'module_disabled', 'Skills are off here.');
      }
      return readConversation(db, identity.userId, c.req.param('conversationId'));
    });
    if (!conversation) throw new GestureRefusal(404, 'not_found', 'No such conversation.');
    const choice = await modelFor(identity);
    if (!choice) throw new GestureRefusal(409, 'assistant_unavailable', 'No model is configured.');
    const { value } = await extract({
      model: choice.model,
      schema: skillDraft,
      system:
        'Tu écris une compétence réutilisable (format Agent Skills) à partir d’une conversation qui a réussi : ' +
        'un nom court en minuscules avec des tirets, une description qui dit ce qu’elle fait et quand l’utiliser, ' +
        'puis des instructions en Markdown, numérotées, générales (sans les données propres à cette conversation).',
      prompt: conversation.messages
        .map((m) => `${m.role === 'user' ? 'Personne' : 'Assistant'} : ${m.content}`)
        .join('\n\n')
        .slice(-40_000),
      metering: {
        store: meteringStore(choice.personal),
        context: {
          organizationId: identity.organizationId,
          actor: { kind: 'person', id: identity.userId, channel: 'web' },
          purpose: purposeOf('skills', choice.personal),
          model: '',
        },
      },
    });
    let skill;
    try {
      skill = skillFromText({
        'SKILL.md': [
          '---',
          `name: ${value.name}`,
          `description: ${JSON.stringify(value.description)}`,
          '---',
          '',
          value.instructions,
          '',
        ].join('\n'),
      });
    } catch (error) {
      if (error instanceof SkillError) {
        throw new GestureRefusal(422, 'skill_invalid', error.problems.join('; '));
      }
      throw error;
    }
    const kept = await transaction(identity.organizationId, (db) =>
      keepSkill(db, identity, skill, 'Gardée depuis une conversation'),
    );
    return c.json({ skill: kept.skill }, 201);
  })
  // The chat, streamed line by line (NDJSON): the conversation, the text as it comes, each tool
  // called and the drafts prepared, then the end. Stopping the request stops the model.
  .post('/chat/stream', (c: Ctx) => streamChat(c))
  // A file attached to the chat (spec 027): read now, sent with her next message.
  .post('/attachments', async (c: Ctx) => {
    const parsed = attachmentInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A file is expected.');
    const { organizationId, userId } = c.get('identity');
    try {
      const saved = await transaction(organizationId, (db) =>
        saveAttachment(db, organizationId, userId, {
          name: parsed.data.name,
          contentType: parsed.data.contentType,
          data: Buffer.from(parsed.data.data, 'base64'),
        }),
      );
      return c.json(saved, 201);
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new GestureRefusal(422, error.code, error.message);
      }
      throw error;
    }
  })
  // The drafts prepared for the person, and her decision (spec 017).
  .get('/drafts', async (c) => {
    const identity = c.get('identity');
    const drafts = await asPerson(identity, () => draftsFor(identity));
    return c.json({
      drafts: await transaction(identity.organizationId, (db) =>
        Promise.all(drafts.map((d) => explainDraft(db, d))),
      ),
    });
  })
  .post('/drafts/:draftId/decide', async (c) => {
    const identity = c.get('identity');
    const parsed = decideInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A decision is required.');
    const result = await asPerson(identity, () =>
      decideDraft(identity, c.req.param('draftId'), parsed.data),
    );
    if (result.status === 'not_possible') {
      const code =
        result.reason === 'not_allowed' ? 403 : result.reason === 'not_found' ? 404 : 409;
      throw new GestureRefusal(code, result.reason, 'This draft cannot be decided.');
    }
    return c.json({ status: result.status });
  })
  // The organization's use of models this month, and its budget: for administrators.
  .get('/usage', async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity))
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    const answer = await transaction(identity.organizationId, async (db) => {
      const { rows } = await db.query<{ purpose: string; calls: string; tokens: string }>(
        `select purpose, count(*) as calls, sum(input_tokens + output_tokens) as tokens
           from kete_ai_usage where created_at >= date_trunc('month', now())
          group by purpose order by purpose`,
      );
      const { rows: budget } = await db.query<{ monthly_tokens: number }>(
        `select monthly_tokens from kete_ai_budgets where scope_kind = 'organization' limit 1`,
      );
      return {
        purposes: rows.map((r) => ({
          purpose: r.purpose,
          calls: Number(r.calls),
          tokens: Number(r.tokens),
        })),
        monthlyTokens: budget[0]?.monthly_tokens ?? null,
      };
    });
    // What it cost, by purpose, model and who asked (spec 037): null where no price is known.
    const lines = await usageStore().report(identity.organizationId);
    const costs = new Map<string, number>();
    for (const line of lines) {
      if (line.costMicroUsd === null) continue;
      costs.set(line.purpose, (costs.get(line.purpose) ?? 0) + line.costMicroUsd);
    }
    answer.purposes = answer.purposes.map((p) => ({
      ...p,
      costMicroUsd: costs.get(p.purpose) ?? null,
    }));
    const config = configured();
    return c.json({
      ...answer,
      lines,
      provider: config?.provider ?? null,
      model: config?.model ?? null,
    });
  })
  .post('/budget', async (c) => {
    const identity = c.get('identity');
    if (!isAdministrator(identity))
      throw new GestureRefusal(403, 'forbidden', 'Administrators only.');
    const parsed = z
      .object({ monthlyTokens: z.number().int().min(0).max(1_000_000_000) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A number of tokens.');
    await budgets().setBudget(
      identity.organizationId,
      { kind: 'organization', id: identity.organizationId },
      parsed.data.monthlyTokens,
    );
    return c.json({ monthlyTokens: parsed.data.monthlyTokens }, 201);
  });

const decideInput = z.object({
  action: z.enum(['validate', 'refuse']),
  reason: z.string().trim().min(1).max(600).optional(),
});

const streamInput = z.object({
  conversationId: z
    .string()
    .regex(/^cnv_[0-9a-f-]{8,64}$/)
    .optional(),
  message: z.string().trim().min(1).max(4000),
  /** Who pays for the answer (spec 026b); the first allowed when absent. */
  payer: z.enum(payers).optional(),
  /** Files attached to this message (spec 027), read when they were attached. */
  attachments: z
    .array(z.string().regex(/^att_[0-9a-f-]{8,64}$/))
    .max(10)
    .default([]),
  /** The page she asks from, when she asks beside it (spec 048): what she is looking at. */
  page: z
    .object({
      kind: z.string().trim().min(1).max(40),
      title: z.string().trim().min(1).max(300),
      href: z
        .string()
        .trim()
        .regex(/^\/[^\s]{0,299}$/),
    })
    .optional(),
});

/** What she is looking at, for the model: its kind, its title, its address in the space. */
const pagePrompt = (page: z.infer<typeof streamInput>['page']) =>
  page
    ? `

Elle te parle depuis la page ${page.href} : ${page.kind} « ${page.title} ». ` +
      'Quand elle dit « ceci » ou « cette page », c’est de cela qu’il s’agit ; lis-le avec tes outils.'
    : '';

const attachmentInput = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: z.string().min(3).max(120),
  /** The file, in base64. */
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8),
});

/** A draft as a tool returned it: its review, for the thread to show and the person to decide. */
function draftOf(output: unknown): unknown {
  const value = output as { status?: string; review?: unknown } | null;
  return value?.status === 'draft' ? (value.review ?? null) : null;
}

async function streamChat(c: Ctx): Promise<Response> {
  const identity = c.get('identity');
  const parsed = streamInput.safeParse(await bodyOf(c));
  if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A message is required.');
  const answerer = await answererFor(identity, parsed.data.payer);
  const { organizationId, userId } = identity;
  const mentioned = readDirectives(parsed.data.message);
  const { conversationId, history, organization, files, people, memories, notes } =
    await transaction(organizationId, async (db) => {
      const id =
        parsed.data.conversationId ??
        (await startConversation(db, organizationId, userId, parsed.data.message));
      const found = await readConversation(db, userId, id);
      if (!found) throw new GestureRefusal(404, 'not_found', 'No such conversation.');
      const files = await takeAttachments(db, userId, id, parsed.data.attachments);
      await appendMessage(db, organizationId, id, {
        role: 'user',
        content: parsed.data.message,
        attachments: files.map((f) => ({
          attachmentId: f.attachmentId,
          name: f.name,
          kind: f.kind,
          pages: f.pages,
        })),
      });
      // People she mentions (@), as the directory shows them to her — never more.
      const people: string[] = [];
      for (const d of mentioned.directives.filter((x) => x.type === 'person' && x.id)) {
        const card = await colleagueCard(db, identity, d.id as string);
        if (card) {
          people.push(
            `${card.name} (compte ${d.id as string}) : ${card.positions.map((p) => `${p.title} (${p.unitName})`).join(', ') || 'sans poste'} ; responsable : ${card.managers.map((x) => x.name).join(', ') || '—'}.`,
          );
        }
      }
      return {
        conversationId: id,
        history: found.messages
          .slice(-20)
          .map((m) => ({ role: m.role, content: readDirectives(m.content).plain })),
        organization: await organizationName(db),
        files,
        people,
        memories: await listMemories(db, userId),
        // What she is busy with, in her own words (spec 055) — never while another views her space.
        notes: c.get('viewedBy') ? '' : await notesPromptFor(db, userId),
      };
    });
  const encoder = new TextEncoder();
  const signal = c.req.raw.signal;
  // The team's apps lend their tools with the person's own token (spec 018) — never while an
  // administrator views a demo person's space: the token would be hers, not the person's.
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  const apps =
    token && !c.get('viewedBy') && answerer.kind === 'model'
      ? await appToolsFor(identity, token).catch(() => null)
      : null;
  const named = mentioned.directives.filter((d) => d.type === 'app').map((d) => `[${d.label}]`);
  // The company's library answers when its module is on (spec 028).
  const library =
    answerer.kind === 'model' &&
    (await transaction(organizationId, (db) => libraryOpen(db, identity)).catch(() => false));
  // The know-how she may use, as skills: the shipped ones and her organization's (spec 031).
  const skills =
    answerer.kind === 'model'
      ? skillsForModel(
          await transaction(organizationId, (db) => skillsOf(db, identity)).catch(() => []),
        )
      : { prompt: '', tools: [] };
  // Her teams' data, summed up from their rows (spec 031).
  const teamData = answerer.kind === 'model' && (await datasetsOpen(identity).catch(() => false));
  // A dashboard proposed for her, which she keeps or not (spec 033).
  const dashboards =
    answerer.kind === 'model' &&
    !c.get('viewedBy') &&
    (await dashboardsOpen(identity).catch(() => false));
  // The answers of the forms she runs (spec 032).
  const forms = answerer.kind === 'model' && (await formsOpen(identity).catch(() => false));
  // The organization's document templates, filled for her (spec 038).
  const documents = answerer.kind === 'model' && (await documentsOpen(identity).catch(() => false));
  const appTools = (apps?.tools ?? []).filter(
    (t) => named.length === 0 || named.some((n) => t.description.startsWith(n)),
  );
  // Her message as the model reads it: her words, what each command asks, the files' text, the
  // images themselves, and the people she mentioned.
  const instructions = await commandInstructions(mentioned.directives);
  const said = [
    mentioned.plain || parsed.data.message,
    ...instructions,
    ...(people.length ? [`Personnes mentionnées :\n${people.join('\n')}`] : []),
    ...files.filter((f) => f.kind === 'text').map((f) => `Pièce jointe « ${f.name} » :\n${f.text}`),
  ].join('\n\n');
  const content = [
    { type: 'text' as const, text: said },
    ...files
      .filter((f) => f.kind === 'image' && f.data)
      .map((f) => ({
        type: 'image' as const,
        image: new Uint8Array(f.data as Buffer),
        mediaType: f.contentType,
      })),
  ];
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: 'conversation', conversationId });
      let text = '';
      const tools: ToolUse[] = [];
      const drafts: unknown[] = [];
      const sources: Source[] = [];
      let canvas: { title: string; content: string } | null = null;
      const views: AppView[] = [];
      try {
        if (answerer.kind === 'subscription') {
          // Her own subscription answers, on her own machine: the whole answer at once.
          text = await subscriptionAgent().answer(answerer.machineId, {
            prompt: subscriptionPrompt(organization, identity.name, history, said, memories),
            images: files
              .filter((f) => f.kind === 'image' && f.data)
              .map((f) => ({ data: new Uint8Array(f.data as Buffer), mediaType: f.contentType })),
          });
          send({ type: 'text', delta: text });
          await transaction(organizationId, (db) => markSubscriptionUsed(db, userId));
          // Journaled as hers: a call on her subscription, no token counted for the organization.
          await budgets()
            .record(
              {
                organizationId,
                actor: {
                  kind: 'agent',
                  id: 'agt_assistant',
                  channel: 'chat',
                  onBehalfOf: { kind: 'person', id: userId },
                },
                purpose: 'chat:subscription',
                model: '',
              },
              { inputTokens: 0, outputTokens: 0, modelCalls: 1 },
            )
            .catch(() => undefined);
        } else {
          await asPerson(identity, async () => {
            const result = await askStream({
              model: answerer.model,
              system:
                system(organization, identity.name) +
                pagePrompt(parsed.data.page) +
                memoryPrompt(memories) +
                notes +
                (skills.prompt
                  ? `

${skills.prompt}`
                  : ''),
              messages: [...history, { role: 'user', content }],
              tools: [
                ...(await toolsForPerson(identity)),
                canvasTool,
                ...(c.get('viewedBy')
                  ? []
                  : [scheduleTool(identity), rememberTool(identity), colleagueTool(identity)]),
                ...(library ? [knowledgeTool(identity)] : []),
                ...(documents && !c.get('viewedBy') ? documentTools(identity) : []),
                ...skills.tools,
                ...(teamData ? datasetTools(identity) : []),
                ...(forms ? formTools(identity) : []),
                ...(dashboards ? dashboardTools(identity) : []),
                ...appTools,
              ],
              maxSteps: 6,
              abortSignal: signal,
              metering: {
                store: meteringStore(answerer.personal),
                context: {
                  organizationId,
                  actor: {
                    kind: 'agent',
                    id: 'agt_assistant',
                    channel: 'chat',
                    onBehalfOf: { kind: 'person', id: userId },
                  },
                  purpose: purposeOf('chat', answerer.personal),
                  model: '',
                },
              },
            });
            for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
              if (part['type'] === 'text-delta') {
                const delta = String(part['text'] ?? part['delta'] ?? '');
                text += delta;
                send({ type: 'text', delta });
              } else if (part['type'] === 'tool-call') {
                send({ type: 'tool', name: part['toolName'], state: 'running' });
              } else if (part['type'] === 'tool-result') {
                const output = part['output'] as { status?: string } | null;
                const state = output?.status === 'refused' ? 'refused' : 'done';
                tools.push({ name: String(part['toolName']), state });
                const prepared = draftOf(output);
                const draft = prepared
                  ? await transaction(organizationId, (db) =>
                      explainDraft(db, prepared as { values: Record<string, unknown> }),
                    )
                  : null;
                if (draft) drafts.push(draft);
                send({ type: 'tool', name: part['toolName'], state, ...(draft ? { draft } : {}) });
                const result = (output as { output?: unknown } | null)?.output;
                // An app's tool that names a view (MCP Apps): the chat shows it with its result.
                const view = apps?.viewOf(String(part['toolName']));
                if (view && state === 'done' && views.length < 6) {
                  const shown: AppView = {
                    tool: String(part['toolName']),
                    resource: view.resourceId,
                    uri: view.uri,
                    input: (part['input'] ?? {}) as Record<string, unknown>,
                    result: result ?? null,
                  };
                  views.push(shown);
                  send({ type: 'view', ...shown });
                }
                if (part['toolName'] === 'canvas_write' && result) {
                  // The document goes to the canvas, beside the conversation.
                  canvas = result as { title: string; content: string };
                  send({ type: 'canvas', ...canvas });
                } else {
                  for (const source of sourcesOf(result)) {
                    if (sources.length < 8 && !sources.some((x) => x.href === source.href)) {
                      sources.push(source);
                      send({ type: 'source', ...source });
                    }
                  }
                }
              } else if (part['type'] === 'error') {
                throw part['error'] instanceof Error ? part['error'] : new Error('model error');
              }
            }
          });
        }
        send({ type: 'done' });
      } catch (error) {
        if (error instanceof BudgetExceededError) send({ type: 'error', code: 'budget_spent' });
        else if (error instanceof SubscriptionLostError) {
          send({ type: 'error', code: 'subscription_lost' });
        } else if (!signal.aborted) {
          console.error('[chat]', (error as Error).message);
          send({ type: 'error', code: 'model_failed' });
        }
      } finally {
        // What was said is kept, even when the person stopped the answer.
        if (text.trim() || tools.length || canvas || views.length) {
          await transaction(organizationId, (db) =>
            appendMessage(db, organizationId, conversationId, {
              role: 'assistant',
              content: text,
              tools,
              drafts,
              sources,
              canvas,
              views,
            }),
          ).catch(() => undefined);
        }
        await apps?.close();
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
