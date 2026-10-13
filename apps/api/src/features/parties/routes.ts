import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { reach, reachesAnything } from '../rights/index.js';
import {
  createParty,
  dropFact,
  duplicates,
  factInput,
  factsOf,
  findParty,
  keepDistinct,
  listParties,
  mergeParties,
  PartyError,
  partyRoles,
  putFact,
  updateParty,
  type PartyRole,
} from './parties.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 073). */
export const partiesPermissions = ['parties:read', 'parties:manage'] as const;

async function holds(c: Ctx, db: SqlExecutor, permission: (typeof partiesPermissions)[number]) {
  return reachesAnything(await reach(db, c.get('identity'), permission));
}

/** Reading third parties: who reads them, or who manages them. */
async function reader(c: Ctx, db: SqlExecutor): Promise<void> {
  if ((await holds(c, db, 'parties:read')) || (await holds(c, db, 'parties:manage'))) return;
  throw new GestureRefusal(403, 'forbidden', 'Third parties are not hers to read.');
}

async function manager(c: Ctx): Promise<void> {
  const { organizationId } = c.get('identity');
  if (await transaction(organizationId, (db) => holds(c, db, 'parties:manage'))) return;
  throw new GestureRefusal(403, 'forbidden', 'Third parties are not hers to change.');
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof PartyError) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 409, error.code, error.message);
    }
    throw error;
  }
}

/**
 * Third parties, under /v1/parties (spec 073): the center's reference of who the organization
 * works with. The screens and the apps — with a person's token, within her rights — read them
 * here; an app says here what it knows of one.
 */
export const partiesRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c: Ctx) => {
    const { organizationId } = c.get('identity');
    const role = c.req.query('role');
    return c.json(
      await transaction(organizationId, async (db) => {
        await reader(c, db);
        return {
          parties: await listParties(db, {
            q: c.req.query('q'),
            role: (partyRoles as readonly string[]).includes(role ?? '')
              ? (role as PartyRole)
              : undefined,
          }),
          manages: await holds(c, db, 'parties:manage'),
        };
      }),
    );
  })
  .post('/', async (c: Ctx) => {
    await manager(c);
    return c.json({ party: await run(c, createParty, await bodyOf(c)) }, 201);
  })
  // The records that look like one third party, for who may merge them.
  .get('/duplicates', async (c: Ctx) => {
    await manager(c);
    const { organizationId } = c.get('identity');
    return c.json({ duplicates: await transaction(organizationId, (db) => duplicates(db)) });
  })
  .post('/merge', async (c: Ctx) => {
    await manager(c);
    return c.json(await run(c, mergeParties, await bodyOf(c)));
  })
  .post('/distinct', async (c: Ctx) => {
    await manager(c);
    return c.json(await run(c, keepDistinct, await bodyOf(c)));
  })
  // One third party with what each app knows of it. A merged record answers with the one that
  // stays: `partyId` is then not the one asked.
  .get('/:partyId', async (c: Ctx) => {
    const { organizationId } = c.get('identity');
    const found = await transaction(organizationId, async (db) => {
      await reader(c, db);
      const party = await findParty(db, c.req.param('partyId') ?? '');
      return party ? { party, facts: await factsOf(db, party.partyId) } : null;
    });
    if (!found) throw new GestureRefusal(404, 'not_found', 'No such third party here.');
    return c.json(found);
  })
  .post('/:partyId', async (c: Ctx) => {
    await manager(c);
    const body = (await bodyOf(c)) as object | null;
    const changed = await run(c, updateParty, { ...body, partyId: c.req.param('partyId') });
    return c.json({ party: changed.party });
  })
  // An app says what it knows of a third party, with the token of a person who reads them.
  .post('/:partyId/facts', async (c: Ctx) => {
    const parsed = factInput.safeParse(await bodyOf(c));
    if (!parsed.success)
      throw new GestureRefusal(422, 'invalid_input', 'A source, a key, a label.');
    const { organizationId } = c.get('identity');
    await transaction(organizationId, async (db) => {
      await reader(c, db);
      const party = await findParty(db, c.req.param('partyId') ?? '');
      if (!party) throw new GestureRefusal(404, 'not_found', 'No such third party here.');
      await putFact(db, organizationId, party.partyId, parsed.data);
    });
    return c.json({ kept: true }, 201);
  })
  .post('/:partyId/facts/drop', async (c: Ctx) => {
    const body = (await bodyOf(c)) as { source?: unknown; key?: unknown } | null;
    if (typeof body?.source !== 'string' || typeof body.key !== 'string') {
      throw new GestureRefusal(422, 'invalid_input', 'A source, a key.');
    }
    const fact = { source: body.source, key: body.key };
    const { organizationId } = c.get('identity');
    const dropped = await transaction(organizationId, async (db) => {
      await reader(c, db);
      const party = await findParty(db, c.req.param('partyId') ?? '');
      return party ? dropFact(db, party.partyId, fact) : false;
    });
    return c.json({ dropped });
  });
