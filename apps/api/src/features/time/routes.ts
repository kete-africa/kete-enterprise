import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { myCard } from '../directory/index.js';
import { projectsFor } from '../projects/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import { readChartAt } from '../structure/index.js';
import {
  clashesOf,
  datedFactInput,
  dropTimeFact,
  factsBetween,
  sayTimeFact,
  visibleTo,
} from './time.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/**
 * The permissions this feature declares (spec 079): saying the time of others — an app's agent,
 * an assistant — and reading the whole organization's.
 */
export const timePermissions = ['time:record', 'time:read'] as const;

async function holds(db: SqlExecutor, c: Ctx, permission: (typeof timePermissions)[number]) {
  return reachesAnything(await reach(db, c.get('identity'), permission));
}

const saidInput = z.object({ source: z.string().trim().min(1).max(80), fact: datedFactInput });
const droppedInput = z.object({
  source: z.string().trim().min(1).max(80),
  key: z.string().min(1).max(200),
});
const weekInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.coerce.number().int().min(1).max(31).default(7),
  scope: z.enum(['me', 'team', 'organization']).default('me'),
});

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Time, under /v1/time (spec 079, doctrine D-050): the apps say their dated facts here, in the
 * contract's shape, with the token of the person they concern — or of who records the time of
 * others; Planifier reads the days of a person, her team or the organization.
 */
export const timeRoutes = new Hono<{ Variables: IdentityVariables }>()
  .post('/facts', async (c: Ctx) => {
    const parsed = saidInput.safeParse(await bodyOf(c));
    if (!parsed.success) {
      throw new GestureRefusal(422, 'invalid_input', 'A source, and a dated fact.');
    }
    const { organizationId, userId } = c.get('identity');
    const { fact } = parsed.data;
    const kept = await transaction(organizationId, async (db) => {
      const hers = (fact.person_ids ?? []).every((p) => p === userId);
      if (!hers && !(await holds(db, c, 'time:record'))) {
        throw new GestureRefusal(403, 'forbidden', 'The time of others is not hers to say.');
      }
      return sayTimeFact(db, organizationId, { ...parsed.data, by: userId });
    });
    return c.json({ [kept]: true }, kept === 'kept' ? 201 : 200);
  })
  .post('/facts/drop', async (c: Ctx) => {
    const parsed = droppedInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A source, a key.');
    const { organizationId, userId } = c.get('identity');
    await transaction(organizationId, async (db) => {
      const { rows } = await db.query<{ person_ids: string[] }>(
        `select person_ids from time_facts where source = $1 and key = $2`,
        [parsed.data.source, parsed.data.key],
      );
      const people = rows[0]?.person_ids ?? [];
      if (!people.every((p) => p === userId) && !(await holds(db, c, 'time:record'))) {
        throw new GestureRefusal(403, 'forbidden', 'The time of others is not hers to take back.');
      }
      await dropTimeFact(db, parsed.data.source, parsed.data.key);
    });
    return c.json({ dropped: true });
  })
  // The days of a person, her team or the organization, as she may see them, and what clashes.
  .get('/days', async (c: Ctx) => {
    const parsed = weekInput.safeParse(c.req.query());
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A day to start from.');
    const { from, days, scope } = parsed.data;
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const everyone = await holds(db, c, 'time:read');
        if (scope === 'organization' && !everyone) {
          throw new GestureRefusal(
            403,
            'forbidden',
            'The organization’s time is not hers to read.',
          );
        }
        const card = await myCard(db, identity);
        const team = (card?.reports ?? []).flatMap((p) => (p.userId ? [p.userId] : []));
        const people = new Set([identity.userId, ...(scope === 'me' ? [] : team)]);
        const projects = new Set(
          (await projectsFor(db, identity.userId, { all: false })).map((p) => p.projectId),
        );
        const facts = visibleTo(await factsBetween(db, from, addDays(from, days - 1)), {
          userId: identity.userId,
          people,
          projects,
          everyone: scope === 'organization',
        });
        // The names of the people her lanes show: herself, her team, or whoever her facts name.
        const chart = await readChartAt(db, from);
        const shown =
          scope === 'organization' ? new Set(facts.flatMap((f) => f.person_ids ?? [])) : people;
        return {
          from,
          days,
          scope,
          canSeeOrganization: everyone,
          facts,
          conflicts: clashesOf(facts),
          people: chart.people
            .filter((p) => p.accountUserId && shown.has(p.accountUserId))
            .map((p) => ({ userId: p.accountUserId as string, name: p.name })),
        };
      }),
    );
  });
