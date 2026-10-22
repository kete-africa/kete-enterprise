import { askStream, BudgetExceededError } from '@kete/ai';
import type { CapabilityTool } from '@kete/capabilities';
import { fillTemplate, policyTemplates, simulatePolicy, TemplateError } from '@kete/policies';
import { newId } from '@kete/records';
import type { Thread } from '@kete/sdk';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { joinThread, messagesOf, postMessage, threadOf } from '@kete/threads';
import { setReturnTo } from '@kete/work';
import { z } from 'zod';
import { asPerson } from '../../platform/acting.js';
import { transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { findAgent, personOfAgent, queueTask, stateOfAgent } from '../agents/index.js';
import type { Agent } from '../agents/index.js';
import {
  createSchedule,
  meteringStore,
  modelFor,
  organizationName,
  purposeOf,
  system,
} from '../assistant/index.js';
import { toolsForPerson } from '../gateway/index.js';
import { readModules } from '../organization/index.js';
import { engine, entitiesFor } from '../policies/index.js';
import { unitsOfPersonAndAbove } from '../rights/index.js';
import { personOfAccount } from '../structure/index.js';
import { sayTimeFact } from '../time/index.js';
import { KETE, me, readable } from './access.js';
import { keteThreadOf } from './center.js';
import { namesOf, stateOf } from './state.js';
import { messageWords } from './words.js';

// Kete, the door (spec 099, FR-007 to FR-011; doctrine D-061). Asked in her thread « Kete », by
// « @Kete » in any thread, from the drawer of any page — or reading, unasked, a message that gives
// orders in a group — Kete takes one turn with her rights, never more: it reads, answers, hands
// work to her agents, and proposes. What it proposes is a set of gestures (holdings, dated facts,
// routines) or a policy from the six templates, simulated over thirty days; nothing exists before
// her « oui ». The turn is kept with its steps; she stops it with « Arrêter ».

type Identity = IdentityVariables['identity'];
type Step = { state: 'done' | 'now' | 'todo' | 'ask'; label: string; tag?: string };

/** Kete's turns and what they propose, with their RLS (spec 099, FR-008 to FR-011). */
export function doorMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const app = options.appRole;
  return `
-- A turn of Kete in a thread: working while it runs, its steps as they come, stopped by her.
create table ${s}.kete_turns (
  organization_id text not null,
  turn_id text primary key,
  thread_id text not null references ${s}.kete_threads (thread_id),
  asked_by text not null,
  state text not null default 'working' check (state in ('working', 'done', 'stopped', 'failed')),
  steps jsonb not null default '[]',
  live text not null default '',
  message_id text references ${s}.kete_messages (message_id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((state = 'working') = (finished_at is null))
);
create index kete_turns_thread on ${s}.kete_turns (thread_id, started_at desc);
${organizationPolicySql({ schema: s, table: 'kete_turns', appRole: app })}
grant select, insert, update on ${s}.kete_turns to ${app};

-- What a turn proposes under its message: a set of gestures, a policy, a part handed to an agent.
create table ${s}.kete_proposals (
  organization_id text not null,
  proposal_id text primary key,
  message_id text not null references ${s}.kete_messages (message_id),
  thread_id text not null references ${s}.kete_threads (thread_id),
  proposed_for text not null,
  kind text not null check (kind in ('gestures', 'policy', 'handover')),
  body jsonb not null,
  state text not null default 'proposed'
    check (state in ('proposed', 'confirmed', 'declined', 'trial', 'adopted', 'handed')),
  made jsonb not null default '{}',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index kete_proposals_message on ${s}.kete_proposals (message_id);
${organizationPolicySql({ schema: s, table: 'kete_proposals', appRole: app })}
grant select, insert, update on ${s}.kete_proposals to ${app};
-- « Inviter quelqu’un »: her thread « Kete » becomes a group (FR-007).
grant update (kind, title) on ${s}.kete_threads to ${app};

-- The page a question to Kete was asked from, through the drawer (FR-007).
create table ${s}.kete_message_pages (
  organization_id text not null,
  message_id text primary key references ${s}.kete_messages (message_id),
  href text not null check (length(href) between 1 and 600),
  title text not null check (length(title) between 1 and 200)
);
${organizationPolicySql({ schema: s, table: 'kete_message_pages', appRole: app })}
grant select, insert on ${s}.kete_message_pages to ${app};
`;
}

// --- What Kete proposes ---------------------------------------------------------------------------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const objectRef = z.object({ kind: z.enum(['project', 'party']), id: z.string().min(3).max(80) });

const gesturesInput = z.object({
  summary: z
    .string()
    .min(2)
    .max(2000)
    .describe('Le compte rendu, dans ses mots, posté dans le fil de l’objet et signé par elle.'),
  object: objectRef
    .optional()
    .describe('Le projet (prj_…) ou le tiers (pty_…) que cela concerne, s’il est reconnu.'),
  holdings: z
    .array(
      z.object({
        what: z.string().min(2).max(300),
        holder: z.string().min(2).max(160).describe('Qui tient : son compte (usr_…) ou son nom.'),
        due: day.optional().describe('Pour quand, AAAA-MM-JJ.'),
        priority: z.enum(['urgent', 'high', 'normal', 'low']).default('normal'),
        returnTo: z
          .string()
          .min(2)
          .max(160)
          .optional()
          .describe('À qui rendre quand c’est fait ; par défaut celle qui l’a confiée.'),
        source: z.string().max(200).optional().describe('D’où cela vient : « de votre vocal ».'),
      }),
    )
    .max(10)
    .default([]),
  dates: z
    .array(
      z.object({
        label: z.string().min(2).max(300),
        day,
        source: z.string().max(200).optional(),
      }),
    )
    .max(10)
    .default([]),
  routines: z
    .array(
      z.object({
        title: z.string().min(2).max(120),
        prompt: z.string().min(2).max(2000).describe('Ce que Kete fait à chaque fois.'),
        cadence: z.enum(['daily', 'weekdays', 'weekly']),
        weekday: z.number().int().min(1).max(7).optional(),
        time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
        source: z.string().max(200).optional(),
      }),
    )
    .max(5)
    .default([]),
});

const policyInput = z.object({
  rule: z.string().min(3).max(500).describe('La règle, dans ses mots.'),
  template: z.enum(policyTemplates.map((t) => t.id) as [string, ...string[]]),
  amount: z.number().int().min(0).optional(),
  approver: z
    .enum(['me', 'manager', 'project.holder', 'on_behalf_of'])
    .optional()
    .describe('« me » : elle-même, qui a énoncé la règle.'),
  channels: z
    .array(z.enum(['whatsapp', 'mail', 'telegram', 'phone']))
    .max(4)
    .optional(),
  from: z.number().int().min(0).max(24).optional(),
  to: z.number().int().min(0).max(24).optional(),
});

const handInput = z.object({
  agent: z.string().regex(/^agt_[0-9A-Za-z_-]{3,80}$/),
  part: z.string().min(2).max(4000).describe('Sa part du travail, dite pour lui.'),
});

export type Gestures = {
  summary: string;
  object: { kind: 'project' | 'party'; id: string; title: string; thread: string | null } | null;
  holdings: {
    what: string;
    holder: string;
    due: string | null;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    returnTo: string;
    source: string | null;
  }[];
  dates: { label: string; day: string; source: string | null }[];
  routines: {
    title: string;
    prompt: string;
    cadence: 'daily' | 'weekdays' | 'weekly';
    weekday: number | null;
    time: string;
    source: string | null;
  }[];
};
export type PolicyProposal = {
  rule: string;
  template: string;
  policy: ReturnType<typeof fillTemplate>;
  simulation: { replayed: number; changed: number; byAgents: number };
};
export type Handover = { agentId: string; part: string; taskId?: string };

interface Collected {
  gestures: Gestures[];
  policies: PolicyProposal[];
  handovers: Handover[];
}

/** A person of the organization by her account or her name: one, or none when unsure. */
async function personNamed(db: SqlExecutor, said: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select account_user_id as id from people
      where account_user_id is not null
        and (account_user_id = $1 or lower(name) = lower($1) or lower(name) like lower($1) || ' %')
      limit 2`,
    [said.trim()],
  );
  return rows.length === 1 ? (rows[0]?.id ?? null) : null;
}

async function objectNamed(db: SqlExecutor, object: z.infer<typeof objectRef>) {
  const { rows } =
    object.kind === 'project'
      ? await db.query<{ id: string; name: string }>(
          `select project_id as id, name from projects where project_id = $1`,
          [object.id],
        )
      : await db.query<{ id: string; name: string }>(
          `select party_id as id, name from parties where party_id = $1`,
          [object.id],
        );
  const found = rows[0];
  if (!found) return null;
  const thread = await threadOf(db, { kind: object.kind, id: found.id });
  return { kind: object.kind, id: found.id, title: found.name, thread: thread?.id ?? null };
}

/** The agents she may hand work to: those that act for her, and those shared with her. */
export async function agentsOfHers(db: SqlExecutor, identity: Identity): Promise<Agent[]> {
  const { rows } = await db.query<{ agent_id: string }>(
    `select agent_id from agents where status = 'active' order by name`,
  );
  const units = await unitsOfPersonAndAbove(db, identity);
  const hers: Agent[] = [];
  for (const { agent_id } of rows) {
    const agent = await findAgent(db, agent_id);
    if (!agent) continue;
    if ((await personOfAgent(db, agent)) === identity.userId) hers.push(agent);
    else if (
      agent.visibility === 'shared' &&
      (agent.sharedWith.length === 0 || agent.sharedWith.some((u) => units.has(u)))
    ) {
      hers.push(agent);
    }
  }
  return hers;
}

/** Kete's three door tools: each one collects what is proposed; nothing is written by them. */
function doorTools(identity: Identity, collected: Collected): CapabilityTool[] {
  const tool = (
    name: string,
    description: string,
    input: z.ZodObject,
    run: (value: never) => Promise<unknown>,
  ): CapabilityTool => ({
    name,
    description,
    input,
    jsonSchema: z.toJSONSchema(input) as Record<string, unknown>,
    autonomy: 1,
    async execute(raw) {
      const parsed = input.safeParse(raw);
      if (!parsed.success) {
        return { status: 'refused', reason: 'invalid_input', issues: parsed.error.issues };
      }
      try {
        return { status: 'done', output: await run(parsed.data as never) };
      } catch (error) {
        return { status: 'done', output: { refused: (error as Error).message } };
      }
    },
  });
  return [
    tool(
      'propose_gestures',
      'Propose à la personne un lot de gestes tirés de ce qu’elle dit : des tenues (qui fait quoi, ' +
        'pour quand, à qui rendre), des dates, des routines. Rien n’existe avant son « oui ». ' +
        'Une seule fois par tour, avec tout le lot.',
      gesturesInput,
      async (value: z.infer<typeof gesturesInput>) =>
        transaction(identity.organizationId, async (db) => {
          const unknown: string[] = [];
          const holdings: Gestures['holdings'] = [];
          for (const h of value.holdings) {
            const holder = await personNamed(db, h.holder);
            if (!holder) {
              unknown.push(h.holder);
              continue;
            }
            const back = h.returnTo ? await personNamed(db, h.returnTo) : null;
            holdings.push({
              what: h.what,
              holder,
              due: h.due ?? null,
              priority: h.priority,
              returnTo: back ?? identity.userId,
              source: h.source ?? null,
            });
          }
          const object = value.object ? await objectNamed(db, value.object) : null;
          collected.gestures.push({
            summary: value.summary,
            object,
            holdings,
            dates: value.dates.map((d) => ({ ...d, source: d.source ?? null })),
            routines: value.routines.map((r) => ({
              ...r,
              weekday: r.cadence === 'weekly' ? (r.weekday ?? 1) : null,
              source: r.source ?? null,
            })),
          });
          return {
            proposed: holdings.length + value.dates.length + value.routines.length,
            ...(unknown.length ? { unknownPeople: unknown } : {}),
          };
        }),
    ),
    tool(
      'propose_policy',
      'Quand un message énonce une règle durable (« tout achat au-delà de 50 000 F passe par moi »), ' +
        'propose la politique d’un des modèles, simulée sur trente jours. Les consignes restent des tenues.',
      policyInput,
      async (value: z.infer<typeof policyInput>) =>
        transaction(identity.organizationId, async (db) => {
          const approver = value.approver === 'me' ? 'direction' : value.approver;
          const policy = fillTemplate(
            value.template,
            {
              ...(value.amount !== undefined ? { amount: value.amount } : {}),
              ...(approver ? { approver } : {}),
              ...(value.channels ? { channels: value.channels } : {}),
              ...(value.from !== undefined ? { from: value.from } : {}),
              ...(value.to !== undefined ? { to: value.to } : {}),
            } as never,
            { owner: identity.userId },
          );
          if (value.approver === 'me') {
            const person = await personOfAccount(db, identity.userId);
            if (person) policy.approver = `person:${person.personId}`;
          }
          const simulated = await simulatePolicy(db, {
            engine,
            policy,
            since: new Date(Date.now() - 30 * 86_400_000),
            entitiesOf: (gesture) => entitiesFor(db, gesture),
          });
          const proposal: PolicyProposal = {
            rule: value.rule,
            template: value.template,
            policy,
            simulation: {
              replayed: simulated.replayed,
              changed: simulated.changed.length,
              byAgents: simulated.changed.filter((c) => c.gesture.actor.kind === 'agent').length,
            },
          };
          collected.policies.push(proposal);
          return { sentence: policy.sentence, simulation: proposal.simulation };
        }).catch((error: unknown) => {
          if (error instanceof TemplateError) throw new Error(error.message);
          throw error;
        }),
    ),
    tool(
      'hand_to_agent',
      'Confie à un de ses agents sa part du travail ; il la fait en parallèle, et rien ne part sans elle.',
      handInput,
      async (value: z.infer<typeof handInput>) =>
        transaction(identity.organizationId, async (db) => {
          const agent = (await agentsOfHers(db, identity)).find((a) => a.agentId === value.agent);
          if (!agent) throw new Error('Cet agent n’est pas à elle.');
          collected.handovers.push({ agentId: agent.agentId, part: value.part });
          return { handed: agent.name };
        }),
    ),
  ];
}

// --- A turn ---------------------------------------------------------------------------------------

/** The turns running in this process, to stop them at once. */
const running = new Map<string, AbortController>();
const settling = new Set<Promise<void>>();

/** Tests: wait until every turn started has finished. */
export async function settleTurns(): Promise<void> {
  while (settling.size > 0) await Promise.allSettled([...settling]);
}

/** What Kete reads of a thread: its object's state, its members, its last messages. */
export async function contextOf(db: SqlExecutor, identity: Identity, thread: Thread) {
  const state = await stateOf(db, thread);
  const messages = (await messagesOf(db, thread.id, { viewer: me(identity) })).slice(-30);
  const members = (thread.members ?? []).filter((m) => !m.until && m.kind === 'person');
  const ids = [
    thread.holder.id,
    ...members.map((m) => m.id),
    ...messages.map((m) => m.author.id),
    ...state.holdings.map((h) => h.holder.id),
    ...state.cards.map((h) => h.holder.id),
  ];
  const names = await namesOf(db, ids, identity, messageWords().outsider);
  return [
    thread.object ? `Objet : ${thread.object.kind} ${thread.object.id}` : 'Fil sans objet.',
    `Membres : ${members.map((m) => `${names[m.id]} (${m.id})`).join(', ') || '—'}`,
    ...state.holdings.map((h) => `En cours : ${h.what} — ${names[h.holder.id]}`),
    ...state.cards.map((h) => `À décider : ${h.what} — ${names[h.holder.id]}`),
    ...state.dates.map((d) => `Date : ${d.label} — ${d.at ?? ''}`),
    '',
    ...messages.map(
      (m) =>
        `${names[m.author.id]} : ${m.text.slice(0, 1500)}${
          m.references?.length
            ? ` [cite ${m.references.map((r) => `${r.kind} ${r.id}`).join(', ')}]`
            : ''
        }`,
    ),
  ].join('\n');
}

const levelWord = (autonomy: number) => {
  const words = messageWords();
  return autonomy >= 3 ? words.levelDraft : words.levelRead;
};

/**
 * Kete takes a turn in a thread, in the background: `review` when it reads, unasked, a message of
 * a group — it then speaks only to propose, and only to its author.
 */
export function startTurn(
  identity: Identity,
  input: { threadId: string; question: string; review?: boolean; page?: string },
): string {
  const turnId = newId('trn');
  const done = runTurn(identity, turnId, input).catch((error: unknown) => {
    console.error('[kete turn]', (error as Error).message);
  });
  settling.add(done);
  void done.finally(() => settling.delete(done));
  return turnId;
}

/** She stops a turn she asked: at once here, and on its next step anywhere else. */
export async function stopTurn(db: SqlExecutor, turnId: string, userId: string) {
  const { rows } = await db.query<{ turn_id: string }>(
    `update kete_turns set state = 'stopped', finished_at = now()
      where turn_id = $1 and asked_by = $2 and state = 'working' returning turn_id`,
    [turnId, userId],
  );
  running.get(turnId)?.abort();
  return rows.length > 0;
}

/** The turn working in a thread, if any. */
export async function workingTurn(db: SqlExecutor, threadId: string) {
  const { rows } = await db.query<{
    turn_id: string;
    asked_by: string;
    steps: Step[];
    live: string;
    started_at: Date;
  }>(
    `select turn_id, asked_by, steps, live, started_at from kete_turns
      where thread_id = $1 and state = 'working' and started_at > now() - interval '10 minutes'
      order by started_at desc limit 1`,
    [threadId],
  );
  const turn = rows[0];
  return turn
    ? {
        turnId: turn.turn_id,
        askedBy: turn.asked_by,
        steps: turn.steps,
        live: turn.live,
        startedAt: turn.started_at.toISOString(),
      }
    : null;
}

async function runTurn(
  identity: Identity,
  turnId: string,
  input: { threadId: string; question: string; review?: boolean; page?: string },
) {
  const started = Date.now();
  const words = messageWords();
  const { organizationId } = identity;
  const { thread, context, agents, organization } = await transaction(
    organizationId,
    async (db) => {
      const thread = await readable(db, identity, input.threadId);
      await db.query(
        `insert into kete_turns (organization_id, turn_id, thread_id, asked_by) values ($1, $2, $3, $4)`,
        [organizationId, turnId, thread.id, identity.userId],
      );
      return {
        thread,
        context: await contextOf(db, identity, thread),
        agents: input.review ? [] : await agentsOfHers(db, identity),
        organization: await organizationName(db),
      };
    },
  );
  const controller = new AbortController();
  running.set(turnId, controller);
  const steps: Step[] = [{ state: 'done', label: words.readThread, tag: words.levelRead }];
  const collected: Collected = { gestures: [], policies: [], handovers: [] };
  let text = '';
  let failure: 'no_model' | 'failed' | null = null;
  let saved = 0;
  // Its steps and its words as they come; a turn stopped elsewhere stops here on its next step.
  const save = async (force = false) => {
    if (!force && Date.now() - saved < 700) return;
    saved = Date.now();
    const { rows } = await transaction(organizationId, (db) =>
      db.query<{ state: string }>(
        `update kete_turns set steps = $2, live = $3 where turn_id = $1 returning state`,
        [turnId, JSON.stringify(steps), text.slice(-2000)],
      ),
    );
    if (rows[0]?.state === 'stopped') controller.abort();
  };
  try {
    const choice = await modelFor(identity);
    if (!choice) failure = 'no_model';
    else {
      await asPerson(identity, async () => {
        const door = doorTools(identity, collected);
        const tools = input.review ? door : [...(await toolsForPerson(identity)), ...door];
        const levelOf = new Map(tools.map((t) => [t.name, t.autonomy]));
        const labelOf = (name: string) =>
          name === 'propose_gestures'
            ? words.proposeGestures
            : name === 'propose_policy'
              ? words.proposePolicy
              : name === 'hand_to_agent'
                ? words.handToAgent
                : name;
        const result = await askStream({
          model: choice.model,
          system: [
            system(organization, identity.name),
            `Tu es Kete, la porte d’entrée de ${identity.name} : tu réponds dans le fil « ${thread.title} ». Sois bref : une réponse de fil, pas un rapport.`,
            'Quand ce qui est dit donne des consignes (qui fait quoi, pour quand), une date ou une routine, appelle propose_gestures une fois avec tout le lot, rattaché à son objet quand tu le reconnais ; rien n’existe avant son « oui ».',
            'Quand une règle durable est énoncée, appelle propose_policy ; les consignes du même message restent des tenues.',
            'Ce qui engage (une dépense, un devis, un message au client) se prépare en brouillon : dis-le, elle le valide.',
            agents.length
              ? `Ses agents, à qui confier une part avec hand_to_agent :\n${agents
                  .map((a) => `- ${a.name} (${a.agentId}) : ${a.mission}`)
                  .join('\n')}`
              : '',
            input.page ? `Elle te parle depuis la page ${input.page}.` : '',
            input.review
              ? 'Ce message ne t’est pas adressé : propose seulement s’il contient une règle ou des consignes, et dis en une phrase ce que tu proposes ; sinon réponds exactement « — ».'
              : '',
            `Le fil et l’état de son objet :\n${context}`,
          ]
            .filter(Boolean)
            .join('\n'),
          messages: [{ role: 'user', content: input.question }],
          tools,
          maxSteps: 6,
          abortSignal: controller.signal,
          metering: {
            store: meteringStore(choice.personal),
            context: {
              organizationId,
              actor: {
                kind: 'agent',
                id: KETE.id,
                channel: 'chat',
                onBehalfOf: { kind: 'person', id: identity.userId },
              },
              purpose: purposeOf('thread', choice.personal),
              model: '',
            },
          },
        });
        for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
          if (part['type'] === 'text-delta') {
            text += String(part['text'] ?? part['delta'] ?? '');
            await save();
          } else if (part['type'] === 'tool-call') {
            const name = String(part['toolName']);
            steps.push({
              state: 'now',
              label: labelOf(name),
              tag: levelWord(levelOf.get(name) ?? 1),
            });
            await save(true);
          } else if (part['type'] === 'tool-result') {
            const label = labelOf(String(part['toolName']));
            const step = steps.findLast((s) => s.label === label && s.state === 'now');
            if (step) step.state = 'done';
            await save(true);
          } else if (part['type'] === 'error') {
            throw part['error'] instanceof Error ? part['error'] : new Error('model error');
          }
        }
      });
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) failure = 'no_model';
    else if (!controller.signal.aborted) {
      console.error('[kete turn]', (error as Error).message);
      failure = 'failed';
    }
  } finally {
    running.delete(turnId);
  }
  const stopped = controller.signal.aborted;
  const proposed =
    collected.gestures.length + collected.policies.length + collected.handovers.length;
  // Read unasked, Kete speaks only to propose.
  if (input.review && (proposed === 0 || failure)) {
    await transaction(organizationId, (db) =>
      db.query(
        `update kete_turns set state = 'done', finished_at = coalesce(finished_at, now())
          where turn_id = $1`,
        [turnId],
      ),
    );
    return;
  }
  const said =
    failure === 'no_model'
      ? words.keteSilent
      : failure === 'failed'
        ? words.keteFailed
        : text.trim() || (stopped ? words.stopped(identity.name) : words.proposedBelow);
  const others = (thread.members ?? []).some(
    (m) => !m.until && m.kind !== 'agent' && !(m.kind === 'person' && m.id === identity.userId),
  );
  // Read beyond the thread with her rights, or read for her unasked: hers alone (FR-009).
  const onlyHers = others && (input.review || steps.length > 1);
  for (const step of steps) if (step.state === 'now') step.state = stopped ? 'todo' : 'done';
  await transaction(organizationId, async (db) => {
    await joinThread(db, organizationId, thread.id, KETE);
    const posted = await postMessage(db, organizationId, {
      thread: thread.id,
      author: KETE,
      text: (stopped && text.trim() ? `${text.trim()}\n\n${words.stopped(identity.name)}` : said)
        .slice(0, 20000)
        .trim(),
      for: 'information',
      via: 'kete',
      mentions: [me(identity)],
      ...(onlyHers ? { only_for: me(identity) } : {}),
    });
    const messageId = posted.message.id;
    await db.query(
      `insert into thread_runs (organization_id, message_id, title, steps, seconds)
       values ($1, $2, $3, $4, $5)`,
      [
        organizationId,
        messageId,
        words.turnTitle({
          read: steps.length,
          gestures: collected.gestures.length > 0,
          policy: collected.policies.length > 0,
          handed: collected.handovers.length,
        }),
        JSON.stringify(steps),
        Math.round((Date.now() - started) / 1000),
      ],
    );
    await db.query(
      `update kete_turns set state = $2, message_id = $3, steps = $4, live = '',
              finished_at = coalesce(finished_at, now())
        where turn_id = $1`,
      [turnId, stopped ? 'stopped' : failure ? 'failed' : 'done', messageId, JSON.stringify(steps)],
    );
    if (!stopped) await keepProposals(db, identity, thread.id, messageId, collected);
  });
}

/** What a turn proposed, under its message; the parts for her agents are handed at once. */
async function keepProposals(
  db: SqlExecutor,
  identity: Identity,
  threadId: string,
  messageId: string,
  collected: Collected,
) {
  const { organizationId } = identity;
  const keep = (kind: string, body: object, state = 'proposed') =>
    db.query(
      `insert into kete_proposals (organization_id, proposal_id, message_id, thread_id,
         proposed_for, kind, body, state)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        newId('prp'),
        messageId,
        threadId,
        identity.userId,
        kind,
        JSON.stringify(body),
        state,
      ],
    );
  for (const set of collected.gestures) {
    // The account of what was said goes to its object's thread, signed by her (case A).
    if (set.object?.thread && set.object.thread !== threadId) {
      await joinThread(db, organizationId, set.object.thread, me(identity));
      await postMessage(db, organizationId, {
        thread: set.object.thread,
        author: me(identity),
        text: set.summary,
        for: 'information',
        via: 'kete',
      });
    }
    await keep('gestures', set);
  }
  for (const policy of collected.policies) await keep('policy', policy);
  for (const handover of collected.handovers) {
    const task = await queueTask(db, {
      organizationId,
      agentId: handover.agentId,
      givenBy: identity.userId,
      instruction: handover.part,
    });
    await keep('handover', { ...handover, taskId: task.taskId }, 'handed');
  }
}

// --- The drawer -----------------------------------------------------------------------------------

/** The door's tools for the drawer's chat, and what they will have proposed. */
export function drawerDoor(identity: Identity) {
  const collected: Collected = { gestures: [], policies: [], handovers: [] };
  return { tools: doorTools(identity, collected), collected };
}

/**
 * The drawer of every page writes into her thread « Kete » (FR-007): her question, with the page
 * it was asked from, then Kete's answer with its steps and what it proposed.
 */
export async function keepInKete(
  identity: Identity,
  said: {
    question: string;
    page?: { href: string; title: string };
    answer: string;
    tools: { name: string; state: string }[];
    seconds: number;
    collected: ReturnType<typeof drawerDoor>['collected'];
  },
) {
  const words = messageWords();
  await transaction(identity.organizationId, async (db) => {
    const thread = await keteThreadOf(db, identity.organizationId, identity.userId);
    const asked = await postMessage(db, identity.organizationId, {
      thread: thread.id,
      author: me(identity),
      text: said.question.slice(0, 20000),
      for: 'information',
      via: 'kete',
    });
    if (said.page) {
      await db.query(
        `insert into kete_message_pages (organization_id, message_id, href, title)
         values ($1, $2, $3, $4)`,
        [identity.organizationId, asked.message.id, said.page.href, said.page.title.slice(0, 200)],
      );
    }
    if (!said.answer.trim() && said.tools.length === 0) return;
    await joinThread(db, identity.organizationId, thread.id, KETE);
    const answered = await postMessage(db, identity.organizationId, {
      thread: thread.id,
      author: KETE,
      text: (said.answer.trim() || words.proposedBelow).slice(0, 20000),
      for: 'information',
      via: 'kete',
    });
    const steps: Step[] = [
      { state: 'done', label: words.readThread, tag: words.levelRead },
      ...said.tools.map((t) => ({
        state: t.state === 'refused' ? ('todo' as const) : ('done' as const),
        label:
          t.name === 'propose_gestures'
            ? words.proposeGestures
            : t.name === 'propose_policy'
              ? words.proposePolicy
              : t.name === 'hand_to_agent'
                ? words.handToAgent
                : t.name,
        tag: words.levelRead,
      })),
    ];
    await db.query(
      `insert into thread_runs (organization_id, message_id, title, steps, seconds)
       values ($1, $2, $3, $4, $5)`,
      [
        identity.organizationId,
        answered.message.id,
        words.turnTitle({
          read: steps.length,
          gestures: said.collected.gestures.length > 0,
          policy: said.collected.policies.length > 0,
          handed: said.collected.handovers.length,
        }),
        JSON.stringify(steps),
        said.seconds,
      ],
    );
    await keepProposals(db, identity, thread.id, answered.message.id, said.collected);
  });
}

/** The pages her questions were asked from, by message. */
export async function pagesOf(db: SqlExecutor, messageIds: string[]) {
  const { rows } = await db.query<{ message_id: string; href: string; title: string }>(
    `select message_id, href, title from kete_message_pages where message_id = any($1)`,
    [messageIds],
  );
  return Object.fromEntries(rows.map((r) => [r.message_id, { href: r.href, title: r.title }]));
}

// --- What she decides -----------------------------------------------------------------------------

export interface ShownProposal {
  proposalId: string;
  messageId: string;
  kind: 'gestures' | 'policy' | 'handover';
  state: string;
  proposedFor: string;
  body: Gestures | PolicyProposal | Handover;
  made: Record<string, unknown>;
  /** A part handed to an agent: where it stands now. */
  agent?: { name: string; state: string; step?: string };
}

/** What Kete proposed under a thread's messages, as the reader may see it. */
export async function proposalsOf(
  db: SqlExecutor,
  threadId: string,
  userId: string,
): Promise<Record<string, ShownProposal[]>> {
  const { rows } = await db.query<{
    proposal_id: string;
    message_id: string;
    kind: ShownProposal['kind'];
    state: string;
    proposed_for: string;
    body: ShownProposal['body'];
    made: Record<string, unknown>;
  }>(
    `select proposal_id, message_id, kind, state, proposed_for, body, made from kete_proposals
      where thread_id = $1 and proposed_for = $2 order by created_at`,
    [threadId, userId],
  );
  const on = (await readModules(db)).agents;
  const shown: Record<string, ShownProposal[]> = {};
  for (const row of rows) {
    const proposal: ShownProposal = {
      proposalId: row.proposal_id,
      messageId: row.message_id,
      kind: row.kind,
      state: row.state,
      proposedFor: row.proposed_for,
      body: row.body,
      made: row.made,
    };
    if (row.kind === 'handover') {
      const handover = row.body as Handover;
      const agent = await findAgent(db, handover.agentId);
      if (agent) {
        const state = await stateOfAgent(db, agent, on);
        const { rows: task } = await db.query<{ status: string }>(
          `select status from agent_tasks where task_id = $1`,
          [handover.taskId],
        );
        proposal.agent = {
          name: agent.name,
          state:
            task[0]?.status === 'done'
              ? 'finished'
              : state.kind === 'waiting'
                ? 'needs'
                : state.kind === 'working' && state.taskId === handover.taskId
                  ? 'working'
                  : (task[0]?.status ?? 'queued') === 'queued'
                    ? 'working'
                    : 'idle',
          ...(state.step ? { step: state.step } : {}),
        };
      }
    }
    (shown[row.message_id] ??= []).push(proposal);
  }
  return shown;
}

export class ProposalError extends Error {
  constructor(
    readonly code: 'not_found' | 'settled' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

async function proposalFor(db: SqlExecutor, proposalId: string, userId: string, kind: string) {
  const { rows } = await db.query<{
    thread_id: string;
    state: string;
    body: unknown;
  }>(
    `select thread_id, state, body from kete_proposals
      where proposal_id = $1 and proposed_for = $2 and kind = $3 for update`,
    [proposalId, userId, kind],
  );
  const found = rows[0];
  if (!found) throw new ProposalError('not_found', 'No such proposal for her.');
  if (found.state !== 'proposed') throw new ProposalError('settled', 'Already decided.');
  return found;
}

export const confirmInput = z.object({
  /** The gestures she keeps, by their place: holdings, then dates, then routines. */
  keep: z.array(z.number().int().min(0).max(40)).max(40).optional(),
  /** Her corrections, by the same place. */
  edits: z
    .record(
      z.string().regex(/^\d{1,2}$/),
      z.object({
        holder: z.string().min(2).max(100).optional(),
        due: day.nullable().optional(),
        priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
        what: z.string().min(2).max(300).optional(),
      }),
    )
    .optional(),
});

/** Her « oui »: the gestures she keeps are made, with her as their author (FR-010). */
export async function confirmGestures(
  db: SqlExecutor,
  identity: Identity,
  proposalId: string,
  input: z.infer<typeof confirmInput>,
) {
  const found = await proposalFor(db, proposalId, identity.userId, 'gestures');
  const set = found.body as Gestures;
  const kept = (index: number) => !input.keep || input.keep.includes(index);
  const where = set.object?.thread ?? found.thread_id;
  const made = { holdings: [] as string[], dates: [] as string[], routines: [] as string[] };
  let index = 0;
  for (const proposed of set.holdings) {
    const at = index++;
    if (!kept(at)) continue;
    const edit = input.edits?.[String(at)] ?? {};
    const holder = edit.holder ?? proposed.holder;
    const due = edit.due === undefined ? proposed.due : edit.due;
    await joinThread(db, identity.organizationId, where, { kind: 'person', id: holder });
    const posted = await postMessage(
      db,
      identity.organizationId,
      {
        thread: where,
        author: me(identity),
        text: edit.what ?? proposed.what,
        for: 'action',
        to: { kind: 'person', id: holder },
        via: 'kete',
      },
      new Date(),
      { ...(due ? { due } : {}), priority: edit.priority ?? proposed.priority },
    );
    if (posted.holdingId) {
      await setReturnTo(db, {
        holdingId: posted.holdingId,
        to: { kind: 'person', id: proposed.returnTo },
      });
      made.holdings.push(posted.holdingId);
    }
  }
  for (const date of set.dates) {
    const at = index++;
    if (!kept(at)) continue;
    const key = `${proposalId}:${at}`;
    await sayTimeFact(db, identity.organizationId, {
      source: 'kete',
      by: identity.userId,
      fact: {
        key,
        kind: 'deadline',
        label: date.label,
        day: date.day,
        person_ids: [identity.userId],
        ...(set.object?.kind === 'project' ? { project_id: set.object.id } : {}),
        ...(set.object?.kind === 'party' ? { party_id: set.object.id } : {}),
      },
    });
    made.dates.push(key);
  }
  for (const routine of set.routines) {
    const at = index++;
    if (!kept(at)) continue;
    const schedule = await createSchedule(
      db,
      {
        organizationId: identity.organizationId,
        userId: identity.userId,
        name: identity.name,
        email: identity.email ?? '',
      },
      {
        kind: 'prompt',
        title: routine.title,
        prompt: routine.prompt,
        cadence: routine.cadence,
        ...(routine.cadence === 'weekly' ? { weekday: routine.weekday ?? 1 } : {}),
        time: routine.time,
        timeZone: 'Africa/Lome',
        byEmail: false,
        locale: 'fr',
      },
    );
    made.routines.push(schedule.scheduleId);
  }
  await db.query(
    `update kete_proposals set state = 'confirmed', made = $2, decided_at = now()
      where proposal_id = $1`,
    [proposalId, JSON.stringify(made)],
  );
  return made;
}

/** Her « non »: nothing is made, the proposal is kept as declined. */
export async function declineProposal(db: SqlExecutor, userId: string, proposalId: string) {
  const { rows } = await db.query(
    `update kete_proposals set state = 'declined', decided_at = now()
      where proposal_id = $1 and proposed_for = $2 and state = 'proposed' returning proposal_id`,
    [proposalId, userId],
  );
  if (rows.length === 0) throw new ProposalError('not_found', 'No such open proposal for her.');
}

/** The policy she adopts or tries: its fields, read under the lock of its proposal. */
export async function policyToDecide(db: SqlExecutor, userId: string, proposalId: string) {
  const found = await proposalFor(db, proposalId, userId, 'policy');
  return (found.body as PolicyProposal).policy;
}

export async function markPolicy(
  db: SqlExecutor,
  proposalId: string,
  state: 'adopted' | 'trial',
  policyId: string,
) {
  await db.query(
    `update kete_proposals set state = $2, made = $3, decided_at = now() where proposal_id = $1`,
    [proposalId, state, JSON.stringify({ policyId })],
  );
}

/**
 * « Inviter quelqu’un » (FR-007): her thread « Kete » becomes a group with the colleagues she
 * invites, who read all that came before; her next question to Kete opens a new thread « Kete ».
 */
export async function inviteToKete(
  db: SqlExecutor,
  identity: Identity,
  thread: Thread,
  people: string[],
) {
  if (thread.kind !== 'kete' || thread.holder.id !== identity.userId) {
    throw new ProposalError('invalid', 'Only her own thread « Kete » takes an invitation.');
  }
  const names = await namesOf(db, people, identity, messageWords().outsider);
  await db.query(`update kete_threads set kind = 'group', title = $2 where thread_id = $1`, [
    thread.id,
    messageWords().keteGroup(identity.name, people.map((id) => names[id] ?? '').filter(Boolean)),
  ]);
  for (const id of people) {
    await joinThread(db, identity.organizationId, thread.id, { kind: 'person', id });
  }
  await postMessage(db, identity.organizationId, {
    thread: thread.id,
    author: KETE,
    text: messageWords().invited(
      identity.name,
      people.map((id) => names[id] ?? '').filter(Boolean),
    ),
    for: 'information',
    via: 'kete',
  });
}

/** What her thread « Kete » shows beside it: the parts handed to her agents, still at work. */
export async function handedNow(db: SqlExecutor, userId: string) {
  const { rows } = await db.query<{
    agent_id: string;
    name: string;
    instruction: string;
    status: string;
  }>(
    `select t.agent_id, a.name, t.instruction, t.status
       from agent_tasks t join agents a on a.agent_id = t.agent_id
      where t.given_by = $1 and t.parent_task_id is null
        and (t.status in ('queued', 'running', 'paused') or t.finished_at > now() - interval '1 day')
      order by t.created_at desc limit 8`,
    [userId],
  );
  return rows.map((r) => ({
    agentId: r.agent_id,
    name: r.name,
    part: r.instruction.slice(0, 200),
    state:
      r.status === 'done'
        ? 'finished'
        : r.status === 'failed' || r.status === 'paused'
          ? 'needs'
          : 'working',
  }));
}
