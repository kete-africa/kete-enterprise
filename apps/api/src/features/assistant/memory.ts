import {
  eraseMemories,
  forget as forgetMemory,
  memoriesFor,
  memoriesOf,
  memoryConsentOf,
  remember as rememberMemory,
  setMemoryConsent,
  type AgentMemory,
} from '@kete/agents';
import type { CapabilityTool } from '@kete/capabilities';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';

// What Kete and her agents remember of a person (spec 029, then spec 106; doctrine D-062; kete-core
// ADR 0018): one memory per person, `@kete/agents`' — hers only, shown to her with who noted each
// line, forgotten one by one or erased whole, kept only while she agrees and as long as she says.
// Her own « retiens que… » is her agreement; an agent never remembers before she agreed.

/** The first table (spec 029): kept for its history, read once by the move to the shared memory. */
export function memoryMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  return `
create table ${s}.assistant_memories (
  organization_id text not null,
  memory_id text not null,
  user_id text not null,
  text text not null check (length(text) between 1 and 300),
  origin text not null check (origin in ('person', 'assistant')),
  created_at timestamptz not null default now(),
  primary key (organization_id, memory_id)
);
create index assistant_memories_user on ${s}.assistant_memories (organization_id, user_id, created_at);
${organizationPolicySql({ schema: s, table: 'assistant_memories', appRole: options.appRole })}
grant select, insert, delete on ${s}.assistant_memories to ${options.appRole};
`;
}

/**
 * The move to one memory (spec 106): what each person asked her assistant to remember becomes hers
 * in the shared memory, and asking was agreeing.
 */
export function sharedMemoryMoveSql(options: { schema: string }): string {
  const s = options.schema;
  return `
insert into ${s}.kete_agent_memory_consents (organization_id, person_id, enabled)
select distinct organization_id, user_id, true from ${s}.assistant_memories
on conflict do nothing;
insert into ${s}.kete_agent_memories (organization_id, memory_id, person_id, text, origin, agent, created_at)
select organization_id, memory_id, user_id, text,
       case when origin = 'person' then 'person' else 'agent' end,
       case when origin = 'assistant' then 'agt_assistant' end, created_at
  from ${s}.assistant_memories
on conflict do nothing;
`;
}

/** The most remembered of one person (the shared memory's own limit). */
export const MAX_MEMORIES = 100;

export interface Memory {
  memoryId: string;
  text: string;
  origin: 'person' | 'assistant' | 'agent';
  /** The agent that noted it, when one did. */
  agent: string | null;
  createdAt: string;
}

const shown = (m: AgentMemory): Memory => ({
  memoryId: m.memoryId,
  text: m.text,
  origin: m.origin === 'person' ? 'person' : m.agent === 'agt_assistant' ? 'assistant' : 'agent',
  agent: m.agent,
  createdAt: m.createdAt,
});

/** What her assistant and her agents read: nothing while she withdrew her agreement. */
export async function listMemories(db: SqlExecutor, userId: string): Promise<Memory[]> {
  return (await memoriesFor(db, userId)).map(shown);
}

export class MemoryFullError extends Error {}
export class NoConsentError extends Error {}

/**
 * Keeps one line about her. Her own ask agrees for her when she never decided; an agent's note
 * needs her agreement. A line already kept is kept once.
 */
export async function remember(
  db: SqlExecutor,
  person: { organizationId: string; userId: string },
  text: string,
  origin: 'person' | 'assistant' | 'agent',
  agent?: string,
): Promise<Memory> {
  const clean = text.trim().slice(0, 300);
  const same = (await memoriesOf(db, person.userId)).find(
    (m) => m.text.toLowerCase() === clean.toLowerCase(),
  );
  if (same) return shown(same);
  const consent = await memoryConsentOf(db, person.userId);
  if (!consent.decidedAt && origin !== 'agent') {
    await setMemoryConsent(
      db,
      person.organizationId,
      person.userId,
      { enabled: true },
      {
        kind: 'person',
        id: person.userId,
      },
    );
  }
  const by =
    origin === 'person'
      ? { kind: 'person' as const, id: person.userId }
      : { kind: 'agent' as const, id: agent ?? 'agt_assistant' };
  const kept = await rememberMemory(
    db,
    person.organizationId,
    {
      personId: person.userId,
      text: clean,
      origin: origin === 'person' ? 'person' : 'agent',
      ...(origin === 'person' ? {} : { agent: agent ?? 'agt_assistant' }),
    },
    by,
  );
  if (kept.status === 'refused') {
    if (kept.reason === 'full') throw new MemoryFullError();
    throw new NoConsentError();
  }
  return {
    memoryId: kept.memoryId,
    text: clean,
    origin,
    agent: origin === 'person' ? null : (agent ?? 'agt_assistant'),
    createdAt: new Date().toISOString(),
  };
}

export async function forget(
  db: SqlExecutor,
  person: { organizationId: string; userId: string },
  memoryId: string,
): Promise<boolean> {
  return forgetMemory(db, person.organizationId, person.userId, memoryId, {
    kind: 'person',
    id: person.userId,
  });
}

/** What the model reads of her memory, after its frame. */
export function memoryPrompt(memories: Memory[]): string {
  if (!memories.length) return '';
  return [
    '',
    'Ce qu’elle t’a demandé de retenir (respecte-le, sans le répéter à chaque réponse) :',
    ...memories.map((m) => `- ${m.text}`),
  ].join('\n');
}

const rememberInput = z.object({
  text: z
    .string()
    .min(3)
    .max(300)
    .describe('Ce qu’il faut retenir, en une phrase, à la deuxième personne : « Vous signez… ».'),
});

/**
 * The tool (level 2): she says « retiens que… » — her assistant, or an agent working for her, keeps
 * it; hers only, shown in « Ce qu'il retient de vous », forgotten when she asks.
 */
export function rememberTool(
  person: { organizationId: string; userId: string },
  agent = 'agt_assistant',
): CapabilityTool {
  return {
    name: 'memory_remember',
    description:
      'Retient une préférence ou un fait durable qu’elle te demande explicitement de retenir (« retiens que… »). Jamais de donnée de paie, de santé ni de secret.',
    input: rememberInput,
    jsonSchema: z.toJSONSchema(rememberInput) as Record<string, unknown>,
    autonomy: 2,
    async execute(input) {
      const parsed = rememberInput.safeParse(input);
      if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
      try {
        const memory = await transaction(person.organizationId, (db) =>
          remember(
            db,
            person,
            parsed.data.text,
            agent === 'agt_assistant' ? 'assistant' : 'agent',
            agent,
          ),
        );
        return { status: 'done', output: { remembered: memory.text } };
      } catch (error) {
        if (error instanceof MemoryFullError || error instanceof NoConsentError) {
          return { status: 'refused', reason: 'not_allowed' };
        }
        throw error;
      }
    },
  };
}

type Ctx = Context<{ Variables: IdentityVariables }>;

function herself(c: Ctx): void {
  if (c.get('viewedBy')) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only the person sets her own memory.');
  }
}

/** Her memory, under /v1/assistant/memories: what is kept, who noted it, her agreement. */
export const memoryRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        memories: (await memoriesOf(db, userId)).map(shown),
        consent: await memoryConsentOf(db, userId),
      })),
    );
  })
  .post('/', async (c) => {
    herself(c);
    const parsed = z.object({ text: z.string().trim().min(3).max(300) }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'One sentence.');
    const identity = c.get('identity');
    try {
      const memory = await transaction(identity.organizationId, (db) =>
        remember(db, identity, parsed.data.text, 'person'),
      );
      return c.json({ memory }, 201);
    } catch (error) {
      if (error instanceof MemoryFullError) {
        throw new GestureRefusal(409, 'memory_full', 'A hundred memories at most.');
      }
      if (error instanceof NoConsentError) {
        throw new GestureRefusal(409, 'no_consent', 'She withdrew her agreement.');
      }
      throw error;
    }
  })
  .post('/:memoryId/forget', async (c) => {
    herself(c);
    const identity = c.get('identity');
    const done = await transaction(identity.organizationId, (db) =>
      forget(db, identity, c.req.param('memoryId')),
    );
    if (!done) throw new GestureRefusal(404, 'not_found', 'No such memory.');
    return c.json({ forgotten: true });
  })
  // Her agreement: given or withdrawn, and how long a memory is kept.
  .put('/consent', async (c) => {
    herself(c);
    const parsed = z
      .object({
        enabled: z.boolean(),
        retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Yes or no, and how long.');
    const { organizationId, userId } = c.get('identity');
    const consent = {
      enabled: parsed.data.enabled,
      ...(parsed.data.retentionDays === undefined
        ? {}
        : { retentionDays: parsed.data.retentionDays }),
    };
    await transaction(organizationId, (db) =>
      setMemoryConsent(db, organizationId, userId, consent, { kind: 'person', id: userId }),
    );
    return c.json({ consent: parsed.data });
  })
  // Everything forgotten at once.
  .post('/erase', async (c) => {
    herself(c);
    const { organizationId, userId } = c.get('identity');
    const erased = await transaction(organizationId, (db) =>
      eraseMemories(db, organizationId, userId, { kind: 'person', id: userId }),
    );
    return c.json({ erased });
  });
