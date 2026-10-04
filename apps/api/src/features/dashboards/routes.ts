import type { CapabilityTool } from '@kete/capabilities';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { queryDatasetFor } from '../datasets/index.js';
import { queryFormFor } from '../forms/index.js';
import { readerKeys } from '../knowledge/index.js';
import { readModules, requireModule } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import {
  createDashboard,
  dashboardInput,
  getDashboard,
  listDashboards,
  removeDashboard,
  updateDashboard,
  widget,
  type Dashboard,
  type Widget,
} from './dashboards.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

/** A card's figures, read with the reader's rights: none when she may not read its source. */
export type Card =
  | { title: string; view: Widget['view']; visible: true; source: string; rows: unknown[] }
  | { title: string; view: Widget['view']; visible: false };

async function cardsFor(db: SqlExecutor, identity: Identity, widgets: Widget[]): Promise<Card[]> {
  const cards: Card[] = [];
  for (const w of widgets) {
    let read: { name: string; rows: unknown[] } | null = null;
    try {
      read =
        w.source.kind === 'dataset'
          ? await queryDatasetFor(db, identity, w.source.id, w.query)
          : await queryFormFor(db, identity, w.source.id, w.query);
    } catch {
      // A source whose columns changed since the card was composed shows nothing.
      read = null;
    }
    cards.push(
      read
        ? { title: w.title, view: w.view, visible: true, source: read.name, rows: read.rows }
        : { title: w.title, view: w.view, visible: false },
    );
  }
  return cards;
}

async function visible(c: Ctx, db: SqlExecutor) {
  const identity = c.get('identity');
  const dashboard = await getDashboard(db, c.req.param('dashboardId') ?? '');
  const admin = isAdministrator(identity) && !c.get('viewedBy');
  const keys = new Set(await readerKeys(db, identity));
  if (!dashboard || (!admin && !dashboard.audience.some((k) => keys.has(k)))) {
    throw new GestureRefusal(404, 'not_found', 'No such dashboard for her.');
  }
  const owner = dashboard.ownerId === identity.userId && !c.get('viewedBy');
  return { dashboard, manage: admin || owner, admin };
}

const audienceKey = z
  .string()
  .regex(/^(everyone|role:admin|unit:[A-Za-z0-9_.-]{1,80}|user:[A-Za-z0-9_.-]{1,80})$/);

/** Dashboards, under /v1/dashboards (spec 033). */
export const dashboardRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('dashboards'))
  .get('/', async (c) => {
    const identity = c.get('identity');
    const admin = isAdministrator(identity) && !c.get('viewedBy');
    const dashboards = await transaction(identity.organizationId, async (db) =>
      listDashboards(db, admin ? null : await readerKeys(db, identity)),
    );
    return c.json({ dashboards });
  })
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to compose.');
    const parsed = dashboardInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A name and cards.');
    const identity = c.get('identity');
    const dashboard = await transaction(identity.organizationId, (db) =>
      createDashboard(db, {
        ...parsed.data,
        organizationId: identity.organizationId,
        ownerId: identity.userId,
        status: 'kept',
      }),
    );
    return c.json({ dashboard }, 201);
  })
  // A dashboard with its cards' figures, each read with the reader's own rights.
  .get('/:dashboardId', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { dashboard, manage } = await visible(c, db);
        return { dashboard, manage, cards: await cardsFor(db, identity, dashboard.widgets) };
      }),
    );
  })
  // Its owner changes it or keeps the assistant's proposal; an administrator opens it to others.
  .post('/:dashboardId', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        description: z.string().trim().max(1000).optional(),
        widgets: z.array(widget).max(12).optional(),
        audience: z.array(audienceKey).min(1).max(50).optional(),
        keep: z.literal(true).optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What changes?');
    const identity = c.get('identity');
    const dashboard = await transaction(identity.organizationId, async (db) => {
      const { dashboard: found, manage, admin } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner decides.');
      if (parsed.data.audience && !admin) {
        throw new GestureRefusal(403, 'forbidden', 'Administrators open a dashboard to others.');
      }
      const { keep, ...rest } = parsed.data;
      const change = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      ) as Parameters<typeof updateDashboard>[2];
      return updateDashboard(db, found.dashboardId, {
        ...change,
        ...(keep ? { status: 'kept' } : {}),
      });
    });
    return c.json({ dashboard });
  })
  .post('/:dashboardId/remove', async (c) => {
    const identity = c.get('identity');
    const removed = await transaction(identity.organizationId, async (db) => {
      const { dashboard, manage } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner decides.');
      return removeDashboard(db, dashboard.dashboardId);
    });
    return c.json({ removed });
  });

/** Whether her organization uses dashboards. */
export async function dashboardsOpen(identity: Identity): Promise<boolean> {
  return transaction(identity.organizationId, async (db) => (await readModules(db)).dashboards);
}

/** A proposal has its cards: an empty dashboard is the person's own to start. */
const proposeInput = dashboardInput.extend({ widgets: z.array(widget).min(1).max(12) });

/**
 * The assistant proposes a dashboard (level 2: it only adds a proposal for her, which she keeps or
 * removes): « Fais-moi un tableau de bord SAV » — its cards over the data she may read.
 */
export function dashboardTools(identity: Identity): CapabilityTool[] {
  return [
    {
      name: 'dashboard_propose',
      description:
        'Propose à la personne un tableau de bord : un nom et des cartes (titre, source dataset ou form avec son identifiant, requête : filtres, regroupements, mesures, et vue number, bar, line, pie ou table). Il reste une proposition jusqu’à ce qu’elle le garde. Lis d’abord les données disponibles (team_datasets) pour nommer de vraies colonnes.',
      input: proposeInput,
      jsonSchema: z.toJSONSchema(proposeInput) as Record<string, unknown>,
      autonomy: 2,
      async execute(input) {
        const parsed = proposeInput.safeParse(input);
        if (!parsed.success)
          return { status: 'refused', reason: 'invalid_input', issues: parsed.error.issues };
        const dashboard: Dashboard = await transaction(identity.organizationId, (db) =>
          createDashboard(db, {
            ...parsed.data,
            organizationId: identity.organizationId,
            ownerId: identity.userId,
            status: 'proposed',
          }),
        );
        return {
          status: 'done',
          output: { name: dashboard.name, href: `/tableaux-de-bord/${dashboard.dashboardId}` },
        };
      },
    },
  ];
}
