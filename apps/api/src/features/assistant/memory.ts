import type { CapabilityTool } from '@kete/capabilities';
import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';

// The assistant's memory (spec 029): what a person asks it to remember about her — « I sign the
// purchases above 1 000 000 FCFA », « my reports in French, amounts in FCFA ». Hers only, shown to
// her, forgotten when she asks; read by her assistant in every conversation and scheduled task.

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

/** The most a person's assistant remembers. */
export const MAX_MEMORIES = 50;

export interface Memory {
  memoryId: string;
  text: string;
  origin: 'person' | 'assistant';
  createdAt: string;
}

export async function listMemories(db: SqlExecutor, userId: string): Promise<Memory[]> {
  const { rows } = await db.query<{
    memory_id: string;
    text: string;
    origin: Memory['origin'];
    created_at: Date;
  }>(
    `select memory_id, text, origin, created_at from assistant_memories
      where user_id = $1 order by created_at`,
    [userId],
  );
  return rows.map((r) => ({
    memoryId: r.memory_id,
    text: r.text,
    origin: r.origin,
    createdAt: r.created_at.toISOString(),
  }));
}

export class MemoryFullError extends Error {}

export async function remember(
  db: SqlExecutor,
  person: { organizationId: string; userId: string },
  text: string,
  origin: Memory['origin'],
): Promise<Memory> {
  const clean = text.trim().slice(0, 300);
  const known = await listMemories(db, person.userId);
  const same = known.find((m) => m.text.toLowerCase() === clean.toLowerCase());
  if (same) return same;
  if (known.length >= MAX_MEMORIES) throw new MemoryFullError();
  const memoryId = newId('mem');
  await db.query(
    `insert into assistant_memories (organization_id, memory_id, user_id, text, origin)
     values ($1, $2, $3, $4, $5)`,
    [person.organizationId, memoryId, person.userId, clean, origin],
  );
  return { memoryId, text: clean, origin, createdAt: new Date().toISOString() };
}

export async function forget(db: SqlExecutor, userId: string, memoryId: string): Promise<boolean> {
  const { rows } = await db.query<{ memory_id: string }>(
    `delete from assistant_memories where user_id = $1 and memory_id = $2 returning memory_id`,
    [userId, memoryId],
  );
  return rows.length > 0;
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
 * The chat's tool (level 2): she says « retiens que… », her assistant keeps it — hers only, shown
 * in « Ce qu’il retient de vous », forgotten when she asks.
 */
export function rememberTool(person: { organizationId: string; userId: string }): CapabilityTool {
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
          remember(db, person, parsed.data.text, 'assistant'),
        );
        return { status: 'done', output: { remembered: memory.text } };
      } catch (error) {
        if (error instanceof MemoryFullError) return { status: 'refused', reason: 'not_allowed' };
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

/** Her assistant's memory, under /v1/assistant/memories. */
export const memoryRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({
      memories: await transaction(organizationId, (db) => listMemories(db, userId)),
    });
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
        throw new GestureRefusal(409, 'memory_full', 'Fifty memories at most.');
      }
      throw error;
    }
  })
  .post('/:memoryId/forget', async (c) => {
    herself(c);
    const { organizationId, userId } = c.get('identity');
    const done = await transaction(organizationId, (db) =>
      forget(db, userId, c.req.param('memoryId')),
    );
    if (!done) throw new GestureRefusal(404, 'not_found', 'No such memory.');
    return c.json({ forgotten: true });
  });
