import {
  aiMigrationSql,
  ask,
  BudgetExceededError,
  languageModel,
  modelConfigFromEnv,
  postgresBudgetStore,
  type ModelConfig,
} from '@kete/ai';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { getPool, transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { toolsForPerson } from '../gateway/index.js';
import { isAdministrator } from '../rights/index.js';
import { personOfAccount } from '../structure/index.js';
import { factsFor, type Facts } from '../workspace/index.js';
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

let store: ReturnType<typeof postgresBudgetStore> | undefined;
const budgets = () => (store ??= postgresBudgetStore(getPool()));

type Model = Parameters<typeof ask>[0]['model'];
let override: Model | undefined;

/** Tests: answer with another model. */
export function useModel(model: Model | undefined): void {
  override = model;
}

function model(): Model | null {
  if (override) return override;
  const config = configured();
  return config ? languageModel(config) : null;
}

const system = (organization: string, name: string) =>
  [
    `Tu es l'assistant de ${name} dans Kete Enterprise, chez ${organization}.`,
    'Tu agis pour elle, avec ses droits et jamais plus : tes outils ne te montrent que ce qu’elle peut voir.',
    'Tu prépares, tu expliques, tu proposes ; tu ne décides jamais à sa place. Une décision, une signature ou une validation se font dans Kete Enterprise, par elle.',
    'Tu n’as aucune donnée de paie ni de salaire, et tu ne les inventes pas.',
    'Quand tu t’appuies sur un outil, dis d’où vient l’information (par exemple : « d’après vos actions ouvertes »).',
    'Réponds en français, brièvement, avec des listes courtes quand c’est utile.',
  ].join('\n');

async function organizationName(db: SqlExecutor): Promise<string> {
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
  if (lines.length === 1) lines.push(w.nothing);
  return lines.join('\n');
}

async function writeBriefing(identity: IdentityVariables['identity'], force: boolean) {
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
  const chosen = model();
  if (chosen) {
    try {
      const answer = await ask({
        model: chosen,
        system: `${system(organization, facts.name)}\nTu écris son briefing du matin : cinq à huit lignes, les urgences d'abord (en retard, à décider, échéances proches), puis où elle en est. Pas de titre, pas de formule creuse.`,
        prompt: `Voici les faits du jour, lus dans ses registres (JSON) :\n${JSON.stringify({ ...facts, apps: undefined })}`,
        maxSteps: 1,
        metering: {
          store: budgets(),
          context: {
            organizationId,
            actor: {
              kind: 'agent',
              id: 'agt_briefing',
              channel: 'worker',
              onBehalfOf: { kind: 'person', id: identity.userId },
            },
            purpose: 'briefing',
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
export const assistantRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', (c) => {
    const config = configured();
    return c.json({
      available: Boolean(override ?? config),
      provider: config?.provider ?? null,
      model: config?.model ?? null,
    });
  })
  .get('/briefing', async (c) => c.json(await writeBriefing(c.get('identity'), false)))
  .post('/briefing', async (c) => c.json(await writeBriefing(c.get('identity'), true), 201))
  .post('/chat', async (c: Ctx) => {
    const chosen = model();
    if (!chosen) {
      throw new GestureRefusal(409, 'assistant_unavailable', 'No model is configured here.');
    }
    const parsed = chatInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'The conversation is not valid.');
    const identity = c.get('identity');
    // Seen « as » a demo person, the assistant is hers: the same rights, the same tools.
    const organization = await transaction(identity.organizationId, organizationName);
    try {
      const answer = await asPerson(identity, async () =>
        ask({
          model: chosen,
          system: system(organization, identity.name),
          messages: parsed.data.messages,
          tools: await toolsForPerson(identity),
          maxSteps: 6,
          metering: {
            store: budgets(),
            context: {
              organizationId: identity.organizationId,
              actor: {
                kind: 'agent',
                id: 'agt_assistant',
                channel: 'chat',
                onBehalfOf: { kind: 'person', id: identity.userId },
              },
              purpose: 'chat',
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
    const config = configured();
    return c.json({ ...answer, provider: config?.provider ?? null, model: config?.model ?? null });
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
