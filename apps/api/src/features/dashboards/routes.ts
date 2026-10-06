import type { CapabilityTool } from '@kete/capabilities';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { queryDatasetFor, type QuerySpec } from '../datasets/index.js';
import { queryFormFor } from '../forms/index.js';
import { readerKeys } from '../knowledge/index.js';
import { readModules, requireModule } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import {
  createDashboard,
  dashboardInput,
  dataWidget,
  getDashboard,
  isNote,
  listDashboards,
  noteWidget,
  pinDashboard,
  pinnedIdsOf,
  removeDashboard,
  saveVersion,
  updateDashboard,
  versionOf,
  versionsOf,
  widget,
  type Dashboard,
  type DataWidget,
  type Widget,
} from './dashboards.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** A copy of a card without one of its keys. */
const without = <T extends object>(value: T, key: string): T =>
  Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)) as T;
type Identity = IdentityVariables['identity'];

/** How the reader looks at a dashboard (spec 050): hers, never saved with it. */
export interface Board {
  period: '7d' | '30d' | '90d' | 'all';
  compare: boolean;
  /** « column = value », set by a click on a bar. */
  filter: { column: string; value: string } | null;
}
const allTime: Board = { period: 'all', compare: false, filter: null };

type Place = NonNullable<Widget['place']>;
interface CardBase {
  id: string;
  title: string;
  place: Place | null;
  proposed: boolean;
}
/** A card as its reader sees it: a note, or figures read with her rights — none when she may not. */
export type Card =
  | (CardBase & { kind: 'note'; text: string })
  | (CardBase & {
      kind: 'data';
      view: DataWidget['view'];
      visible: true;
      source: string;
      rows: unknown[];
      /** The same query over the period before, when she compares. */
      previous: unknown[] | null;
      /** Whether the board's filter applies to it: null without a filter. */
      filtered: boolean | null;
      goal: DataWidget['goal'] | null;
      threshold: number | null;
    })
  | (CardBase & { kind: 'data'; view: DataWidget['view']; visible: false });

const day = (d: Date) => d.toISOString().slice(0, 10);
/** The days a period covers, and the same length just before. */
export function periodDates(
  period: Board['period'],
  today = new Date(),
): { now: { from: string; to: string }; before: { from: string; to: string } } | null {
  if (period === 'all') return null;
  const length = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const shift = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000);
  const from = shift(today, -(length - 1));
  const beforeTo = shift(from, -1);
  return {
    now: { from: day(from), to: day(today) },
    before: { from: day(shift(beforeTo, -(length - 1))), to: day(beforeTo) },
  };
}

async function readSource(
  db: SqlExecutor,
  identity: Identity,
  w: DataWidget,
  query: QuerySpec,
): Promise<{ name: string; rows: unknown[] } | null> {
  return w.source.kind === 'dataset'
    ? queryDatasetFor(db, identity, w.source.id, query)
    : queryFormFor(db, identity, w.source.id, query);
}

async function dataCard(
  db: SqlExecutor,
  identity: Identity,
  w: DataWidget,
  board: Board,
): Promise<Card> {
  const base = {
    id: w.id ?? '',
    title: w.title,
    place: w.place ?? null,
    proposed: w.proposed === true,
    kind: 'data' as const,
    view: w.view,
  };
  const dates = periodDates(board.period);
  const dated = (q: QuerySpec, span?: { from: string; to: string }) =>
    span ? { ...q, from: span.from, to: span.to } : q;
  const narrowed = (q: QuerySpec) =>
    board.filter
      ? {
          ...q,
          filters: [
            ...q.filters,
            { column: board.filter.column, op: 'eq' as const, value: board.filter.value },
          ],
        }
      : q;
  const attempt = async (q: QuerySpec) => {
    try {
      return await readSource(db, identity, w, q);
    } catch {
      // A source whose columns changed since the card was composed — or without the filter's
      // column — shows nothing for this query.
      return undefined;
    }
  };
  let query = dated(w.query, dates?.now);
  let filtered: boolean | null = null;
  let read: { name: string; rows: unknown[] } | null | undefined;
  if (board.filter) {
    read = await attempt(narrowed(query));
    filtered = read !== undefined;
    if (filtered) query = narrowed(query);
    else read = await attempt(query);
  } else {
    read = await attempt(query);
  }
  if (!read) return { ...base, visible: false };
  const previous =
    board.compare && dates
      ? ((await attempt(dated(filtered ? narrowed(w.query) : w.query, dates.before)))?.rows ?? null)
      : null;
  return {
    ...base,
    visible: true,
    source: read.name,
    rows: read.rows,
    previous,
    filtered,
    goal: w.goal ?? null,
    threshold: w.threshold ?? null,
  };
}

/** A dashboard's cards, each read with the reader's own rights and her board. */
async function cardsFor(
  db: SqlExecutor,
  identity: Identity,
  widgets: Widget[],
  board: Board = allTime,
): Promise<Card[]> {
  const cards: Card[] = [];
  for (const w of widgets) {
    cards.push(
      isNote(w)
        ? {
            kind: 'note',
            id: w.id ?? '',
            title: w.title,
            text: w.text,
            place: w.place ?? null,
            proposed: w.proposed === true,
          }
        : await dataCard(db, identity, w, board),
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

const boardOf = (c: Ctx): Board => {
  const period = c.req.query('period');
  const filter = /^([^:]{1,80}):(.{1,200})$/.exec(c.req.query('filter') ?? '');
  return {
    period: period === '7d' || period === '30d' || period === '90d' ? period : 'all',
    compare: c.req.query('compare') === '1',
    filter: filter ? { column: filter[1] ?? '', value: filter[2] ?? '' } : null,
  };
};

/** Dashboards, under /v1/dashboards (specs 033, 050). */
export const dashboardRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('dashboards'))
  .get('/', async (c) => {
    const identity = c.get('identity');
    const admin = isAdministrator(identity) && !c.get('viewedBy');
    const dashboards = await transaction(identity.organizationId, async (db) => {
      const pinned = new Set(await pinnedIdsOf(db, identity.userId));
      return (await listDashboards(db, admin ? null : await readerKeys(db, identity))).map((d) => ({
        ...d,
        pinned: pinned.has(d.dashboardId),
      }));
    });
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
  // A dashboard with its cards' figures, each read with the reader's own rights and her board.
  .get('/:dashboardId', async (c) => {
    const identity = c.get('identity');
    const board = boardOf(c);
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { dashboard, manage } = await visible(c, db);
        const pinned = (await pinnedIdsOf(db, identity.userId)).includes(dashboard.dashboardId);
        return {
          dashboard,
          manage,
          pinned,
          board,
          cards: await cardsFor(db, identity, dashboard.widgets, board),
        };
      }),
    );
  })
  // Its owner changes it or keeps the assistant's proposal; an administrator opens it to others.
  // Every change of its name or its cards keeps the state before it (spec 050).
  .post('/:dashboardId', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        description: z.string().trim().max(1000).optional(),
        widgets: z.array(widget).max(24).optional(),
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
      if (rest.widgets || rest.name) {
        await saveVersion(db, {
          organizationId: identity.organizationId,
          dashboard: found,
          savedBy: identity.userId,
        });
      }
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
  // Its kept versions, for its owner (spec 050).
  .get('/:dashboardId/versions', async (c) => {
    const identity = c.get('identity');
    const versions = await transaction(identity.organizationId, async (db) => {
      const { dashboard, manage } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner reads its versions.');
      return versionsOf(db, dashboard.dashboardId);
    });
    return c.json({ versions });
  })
  // Back to a version: the state it leaves becomes a version in turn, so nothing is lost.
  .post('/:dashboardId/versions/:version/restore', async (c) => {
    const version = Number(c.req.param('version'));
    if (!Number.isInteger(version) || version < 1) {
      throw new GestureRefusal(422, 'invalid_input', 'Which version?');
    }
    const identity = c.get('identity');
    const dashboard = await transaction(identity.organizationId, async (db) => {
      const { dashboard: found, manage } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner decides.');
      const kept = await versionOf(db, found.dashboardId, version);
      if (!kept) throw new GestureRefusal(404, 'not_found', 'No such version.');
      await saveVersion(db, {
        organizationId: identity.organizationId,
        dashboard: found,
        savedBy: identity.userId,
      });
      return updateDashboard(db, found.dashboardId, { name: kept.name, widgets: kept.widgets });
    });
    return c.json({ dashboard });
  })
  // A reader makes her own version of a dashboard she may read; the original never changes.
  .post('/:dashboardId/fork', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to make.');
    const parsed = z
      .object({ name: z.string().trim().min(1).max(160).optional() })
      .safeParse((await bodyOf(c)) ?? {});
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A name, or none.');
    const identity = c.get('identity');
    const dashboard = await transaction(identity.organizationId, async (db) => {
      const { dashboard: original } = await visible(c, db);
      return createDashboard(db, {
        name: parsed.data.name ?? original.name,
        ...(original.description ? { description: original.description } : {}),
        widgets: original.widgets.map((w) => without(w, 'proposed')),
        organizationId: identity.organizationId,
        ownerId: identity.userId,
        status: 'kept',
        forkedFrom: original.dashboardId,
      });
    });
    return c.json({ dashboard }, 201);
  })
  // She pins a dashboard she may read on her « Aujourd'hui », or unpins it (spec 046).
  .post('/:dashboardId/pin', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to pin.');
    const parsed = z.object({ pinned: z.boolean() }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Pinned or not.');
    const identity = c.get('identity');
    await transaction(identity.organizationId, async (db) => {
      const { dashboard } = await visible(c, db);
      await pinDashboard(db, {
        organizationId: identity.organizationId,
        userId: identity.userId,
        dashboardId: dashboard.dashboardId,
        pinned: parsed.data.pinned,
      });
    });
    return c.json({ pinned: parsed.data.pinned });
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

/**
 * The dashboards she pinned and may still read, with their cards' figures read with her rights —
 * for her « Aujourd'hui » (spec 046). A dashboard closed to her since stays pinned, unseen.
 */
export async function pinnedDashboardsFor(
  db: SqlExecutor,
  identity: Identity,
  options: { admin: boolean; limit: number },
): Promise<{ dashboard: Dashboard; cards: Card[] }[]> {
  const ids = await pinnedIdsOf(db, identity.userId);
  if (ids.length === 0) return [];
  const keys = new Set(await readerKeys(db, identity));
  const pinned: { dashboard: Dashboard; cards: Card[] }[] = [];
  for (const id of ids) {
    if (pinned.length >= options.limit) break;
    const dashboard = await getDashboard(db, id);
    if (!dashboard || (!options.admin && !dashboard.audience.some((k) => keys.has(k)))) continue;
    pinned.push({ dashboard, cards: await cardsFor(db, identity, dashboard.widgets) });
  }
  return pinned;
}

/**
 * The figures a person may watch (spec 051): her readable dashboards and their figure cards — a
 * card shown as a number.
 */
export async function figuresFor(
  db: SqlExecutor,
  identity: Identity,
): Promise<{ dashboardId: string; name: string; cards: { id: string; title: string }[] }[]> {
  const admin = isAdministrator(identity);
  const dashboards = await listDashboards(db, admin ? null : await readerKeys(db, identity));
  return dashboards
    .map((d) => ({
      dashboardId: d.dashboardId,
      name: d.name,
      cards: d.widgets.flatMap((w) =>
        !isNote(w) && w.view === 'number' ? [{ id: w.id ?? '', title: w.title }] : [],
      ),
    }))
    .filter((d) => d.cards.length > 0);
}

/**
 * One figure, read with the person's rights: its card's first number; null when the dashboard,
 * the card or its source is no longer hers to read.
 */
export async function readFigure(
  db: SqlExecutor,
  identity: Identity,
  dashboardId: string,
  cardId: string,
): Promise<{ title: string; value: number } | null> {
  const dashboard = await getDashboard(db, dashboardId);
  if (!dashboard) return null;
  const keys = new Set(await readerKeys(db, identity));
  if (!isAdministrator(identity) && !dashboard.audience.some((k) => keys.has(k))) return null;
  const w = dashboard.widgets.find((x) => x.id === cardId);
  if (!w || isNote(w)) return null;
  const card = await dataCard(db, identity, w, allTime);
  if (card.kind !== 'data' || !card.visible) return null;
  const first = (card.rows[0] ?? {}) as Record<string, unknown>;
  const value = Object.values(first).find((v): v is number => typeof v === 'number');
  return value === undefined ? null : { title: w.title, value };
}

/** Whether her organization uses dashboards. */
export async function dashboardsOpen(identity: Identity): Promise<boolean> {
  return transaction(identity.organizationId, async (db) => (await readModules(db)).dashboards);
}

/** A proposal has its cards: an empty dashboard is the person's own to start. */
const proposeInput = dashboardInput.extend({
  widgets: z.array(widget).min(1).max(12),
  pin: z
    .boolean()
    .optional()
    .describe('Épingler sur son « Aujourd’hui » — seulement si elle le demande.'),
});

const dashboardRef = z.string().regex(/^dsh_[0-9A-Za-z_-]{4,70}$/);
const readInput = z.object({ dashboardId: dashboardRef });
const changeInput = z.object({
  dashboardId: dashboardRef,
  name: z.string().trim().min(1).max(160).optional(),
  add: z
    .array(widget)
    .max(6)
    .optional()
    .describe('Cartes à proposer : elles restent des propositions jusqu’à ce qu’elle les garde.'),
  remove: z.array(z.string().min(1).max(30)).max(24).optional().describe('Identifiants de cartes.'),
  change: z
    .array(
      z.object({
        id: z.string().min(1).max(30),
        title: z.string().trim().min(1).max(160).optional(),
        view: dataWidget.shape.view.optional(),
        goal: dataWidget.shape.goal.unwrap().nullable().optional(),
        threshold: z.number().finite().nullable().optional(),
        text: noteWidget.shape.text.optional(),
      }),
    )
    .max(24)
    .optional(),
});

/** Applies the assistant's change to a dashboard's cards: added ones are proposals. */
export function changeWidgets(widgets: Widget[], input: z.infer<typeof changeInput>): Widget[] {
  const removed = new Set(input.remove ?? []);
  const changes = new Map((input.change ?? []).map((ch) => [ch.id, ch]));
  const kept = widgets
    .filter((w) => !removed.has(w.id ?? ''))
    .map((w): Widget => {
      const ch = changes.get(w.id ?? '');
      if (!ch) return w;
      if (isNote(w)) {
        return {
          ...w,
          ...(ch.title ? { title: ch.title } : {}),
          ...(ch.text ? { text: ch.text } : {}),
        };
      }
      const next: DataWidget = {
        ...w,
        ...(ch.title ? { title: ch.title } : {}),
        ...(ch.view ? { view: ch.view } : {}),
      };
      if (ch.goal === null) delete next.goal;
      else if (ch.goal) next.goal = ch.goal;
      if (ch.threshold === null) delete next.threshold;
      else if (ch.threshold !== undefined) next.threshold = ch.threshold;
      return next;
    });
  const added = (input.add ?? []).map((w) => ({ ...without(w, 'id'), proposed: true }) as Widget);
  return [...kept, ...added].slice(0, 24);
}

/**
 * The assistant's dashboards (spec 033, 050): it proposes a new one, reads one she may read, and
 * changes one she owns — every change kept as a version, added cards as proposals (level 2).
 */
export function dashboardTools(identity: Identity): CapabilityTool[] {
  return [
    {
      name: 'dashboard_propose',
      description:
        'Propose à la personne un tableau de bord : un nom et des cartes (titre, source dataset ou form avec son identifiant, requête : filtres, regroupements, mesures, et vue number, bar, line, pie ou table ; un objectif et un seuil si elle en parle ; ou une note : kind « note », un titre et un texte). Il reste une proposition jusqu’à ce qu’elle le garde. Lis d’abord les données disponibles (team_datasets) pour nommer de vraies colonnes.',
      input: proposeInput,
      jsonSchema: z.toJSONSchema(proposeInput) as Record<string, unknown>,
      autonomy: 2,
      async execute(input) {
        const parsed = proposeInput.safeParse(input);
        if (!parsed.success)
          return { status: 'refused', reason: 'invalid_input', issues: parsed.error.issues };
        const { pin, ...proposal } = parsed.data;
        const dashboard: Dashboard = await transaction(identity.organizationId, async (db) => {
          const created = await createDashboard(db, {
            ...proposal,
            organizationId: identity.organizationId,
            ownerId: identity.userId,
            status: 'proposed',
          });
          // Pinned at her word (spec 048): a view on her « Aujourd'hui », which she unpins.
          if (pin) {
            await pinDashboard(db, {
              organizationId: identity.organizationId,
              userId: identity.userId,
              dashboardId: created.dashboardId,
              pinned: true,
            });
          }
          return created;
        });
        return {
          status: 'done',
          output: { name: dashboard.name, href: `/tableaux-de-bord/${dashboard.dashboardId}` },
        };
      },
    },
    {
      name: 'dashboard_read',
      description:
        'Lit un tableau de bord qu’elle peut lire (son identifiant est dans l’adresse /tableaux-de-bord/dsh_…) : son nom, ses cartes avec leur identifiant, leur vue, leur source, leur objectif et leur seuil.',
      input: readInput,
      jsonSchema: z.toJSONSchema(readInput) as Record<string, unknown>,
      autonomy: 1,
      async execute(input) {
        const parsed = readInput.safeParse(input);
        if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
        const found = await transaction(identity.organizationId, async (db) => {
          const dashboard = await getDashboard(db, parsed.data.dashboardId);
          const keys = new Set(await readerKeys(db, identity));
          if (
            !dashboard ||
            (!isAdministrator(identity) && !dashboard.audience.some((k) => keys.has(k)))
          ) {
            return null;
          }
          return dashboard;
        });
        if (!found) return { status: 'refused', reason: 'not_allowed' };
        return {
          status: 'done',
          output: {
            name: found.name,
            hers: found.ownerId === identity.userId,
            cards: found.widgets.map((w) =>
              isNote(w)
                ? { id: w.id, kind: 'note', title: w.title, text: w.text }
                : {
                    id: w.id,
                    kind: 'data',
                    title: w.title,
                    view: w.view,
                    source: w.source,
                    query: w.query,
                    goal: w.goal ?? null,
                    threshold: w.threshold ?? null,
                    proposed: w.proposed === true,
                  },
            ),
          },
        };
      },
    },
    {
      name: 'dashboard_change',
      description:
        'Change un tableau de bord qui est le sien : ajoute des cartes (des propositions qu’elle garde ou retire), retire ou modifie des cartes par leur identifiant (titre, vue, objectif, seuil, texte d’une note), renomme. Lis-le d’abord avec dashboard_read. Chaque changement est gardé comme une version : elle peut revenir en arrière.',
      input: changeInput,
      jsonSchema: z.toJSONSchema(changeInput) as Record<string, unknown>,
      autonomy: 2,
      async execute(input) {
        const parsed = changeInput.safeParse(input);
        if (!parsed.success)
          return { status: 'refused', reason: 'invalid_input', issues: parsed.error.issues };
        const result = await transaction(identity.organizationId, async (db) => {
          const dashboard = await getDashboard(db, parsed.data.dashboardId);
          if (!dashboard || dashboard.ownerId !== identity.userId) return null;
          await saveVersion(db, {
            organizationId: identity.organizationId,
            dashboard,
            savedBy: identity.userId,
          });
          return updateDashboard(db, dashboard.dashboardId, {
            ...(parsed.data.name ? { name: parsed.data.name } : {}),
            widgets: changeWidgets(dashboard.widgets, parsed.data),
          });
        });
        if (!result) return { status: 'refused', reason: 'not_allowed' };
        return {
          status: 'done',
          output: {
            name: result.name,
            href: `/tableaux-de-bord/${result.dashboardId}`,
            added: parsed.data.add?.length ?? 0,
            removed: parsed.data.remove?.length ?? 0,
            changed: parsed.data.change?.length ?? 0,
          },
        };
      },
    },
  ];
}
