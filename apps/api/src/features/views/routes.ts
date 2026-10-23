import type { CommandDefinition } from '@kete/commands';
import type { View } from '@kete/sdk';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import type { ReadingFilter } from '../measure/index.js';
import { isAdministrator } from '../rights/index.js';
import { restoreView, setView, versionsOf, viewFor, ViewRefusal } from './configs.js';
import { readView } from './read.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

const day = /^\d{4}-\d{2}-\d{2}$/;
const ids: Record<keyof ReadingFilter, RegExp> = {
  project_id: /^prj_[0-9a-f-]{8,64}$/,
  party_id: /^pty_[0-9a-f-]{8,64}$/,
  unit_id: /^unt_[0-9a-f-]{8,64}$/,
  person_id: /^[A-Za-z0-9_-]{1,100}$/,
};
const bearer = (c: Ctx) => /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1] ?? null;

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  try {
    return await runGesture(c, definition, input);
  } catch (error) {
    if (error instanceof ViewRefusal) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 422, error.code, error.message);
    }
    throw error;
  }
}

/**
 * Who may write a layer: her own version, always; a position's or the organization's, an
 * administrator. The owner of a person's layer is the person herself, never another.
 */
function layerOf(c: Ctx, body: { level?: unknown; owner?: unknown }) {
  const identity = c.get('identity');
  const level = body.level === 'organization' || body.level === 'position' ? body.level : 'person';
  if (level !== 'person' && !isAdministrator(identity)) {
    throw new GestureRefusal(403, 'forbidden', 'Only an administrator configures for others.');
  }
  const owner =
    level === 'person' ? identity.userId : level === 'position' ? String(body.owner ?? '') : '';
  if (level === 'position' && !owner) throw new GestureRefusal(422, 'invalid', 'Which position?');
  return { level, owner } as const;
}

/** Views configured where they are used, under /v1/views (spec 103). */
export const viewsRoutes = new Hono<{ Variables: IdentityVariables }>()
  // The view a place shows her, and every layer that reaches her.
  .get('/:place', async (c: Ctx) => {
    const identity = c.get('identity');
    const answer = await transaction(identity.organizationId, (db) =>
      viewFor(db, identity, c.req.param('place') ?? ''),
    );
    if (!answer.shown) throw new GestureRefusal(404, 'not_found', 'No view for this place.');
    return c.json({
      view: answer.shown.view,
      level: answer.shown.level,
      version: answer.shown.version,
      layers: answer.layers.map((l) => ({ level: l.level, owner: l.owner, version: l.version })),
      administrator: isAdministrator(identity),
    });
  })
  .put('/:place', async (c: Ctx) => {
    const identity = c.get('identity');
    const body = (await bodyOf(c)) as { level?: unknown; owner?: unknown; view?: unknown };
    const { level, owner } = layerOf(c, body);
    return c.json(
      await run(c, setView, {
        place: c.req.param('place') ?? '',
        level,
        owner,
        view: body.view,
        by: identity.userId,
      }),
    );
  })
  .get('/:place/versions', async (c: Ctx) => {
    const identity = c.get('identity');
    const { level, owner } = layerOf(c, c.req.query());
    return c.json({
      versions: await transaction(identity.organizationId, (db) =>
        versionsOf(db, { place: c.req.param('place') ?? '', level, owner }),
      ),
    });
  })
  // Back to a version — or to none, the layer below showing again.
  .post('/:place/restore', async (c: Ctx) => {
    const identity = c.get('identity');
    const body = (await bodyOf(c)) as { level?: unknown; owner?: unknown; version?: unknown };
    const { level, owner } = layerOf(c, body);
    const version = typeof body.version === 'number' ? body.version : null;
    return c.json(
      await run(c, restoreView, {
        place: c.req.param('place') ?? '',
        level,
        owner,
        version,
        by: identity.userId,
      }),
    );
  });

/** `POST /v1/views/read`: what one view shows her, with the board's filters and period. */
export async function readViewRoute(c: Ctx) {
  const identity = c.get('identity');
  const body = (await bodyOf(c)) as {
    view?: unknown;
    filter?: unknown;
    from?: unknown;
    to?: unknown;
  };
  const view = body.view as View | undefined;
  if (!view || typeof view !== 'object') throw new GestureRefusal(422, 'invalid', 'Which view?');
  const raw = (body.filter ?? {}) as Record<string, unknown>;
  const filter: ReadingFilter = {};
  for (const [key, pattern] of Object.entries(ids) as [keyof ReadingFilter, RegExp][]) {
    const value = raw[key];
    if (typeof value === 'string' && pattern.test(value)) filter[key] = value;
  }
  const period =
    typeof body.from === 'string' &&
    typeof body.to === 'string' &&
    day.test(body.from) &&
    day.test(body.to)
      ? { from: body.from, to: body.to }
      : null;
  return c.json(
    await transaction(identity.organizationId, (db) =>
      readView({ db, identity, token: bearer(c) }, view, { filter, period }),
    ),
  );
}
