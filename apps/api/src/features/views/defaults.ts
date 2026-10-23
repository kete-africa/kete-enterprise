import type { View } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { listIndicators } from '../measure/index.js';
import { viewWords } from './words.js';

// Kete's default views (spec 103; ADR 0016): what a place shows before anyone configures it —
// declared once, here, as an app declares its own in its manifest. The steering board is built from
// the organization's own indicators and the center's sources, so that it is never empty.

/** The places Kete Enterprise configures, and their slot. */
export const PLACES = ['board:steering'] as const;

const card = (view: View, x: number, y: number, w: number, h: number, phone: number) => ({
  view,
  place: { x, y, w, h },
  phone,
});

/** The steering board: the quarter's indicators, then what the center itself can show. */
async function steering(db: SqlExecutor): Promise<View> {
  const words = viewWords();
  const indicators = await listIndicators(db);
  const sourced = indicators.filter((i) => i.source && i.source.kind !== 'typed');
  const ruled = sourced.filter((i) => i.direction !== null);
  const both = (fr: string, en: string) => ({ fr, en });
  const glance = indicators.slice(0, 12).map((i) => i.indicatorId);
  const [first, ...rest] = glance;
  const cards = [
    ...(first
      ? [
          card(
            {
              kind: 'figure',
              title: both(words.fr.glance, words.en.glance),
              source: { indicators: [first, ...rest] },
              context: ['unit', 'period'],
              figure: { chart: 'scorecard', period: 'quarter' },
            },
            0,
            0,
            7,
            5,
            0,
          ),
        ]
      : []),
    ...ruled.slice(0, 2).map((indicator, i) =>
      card(
        {
          kind: 'figure',
          title: both(indicator.name, indicator.name),
          source: { indicators: [indicator.indicatorId] },
          context: ['unit', 'period'],
          figure: {
            chart: 'bullet',
            period: 'quarter',
            ...(indicator.unit === 'percent' ? { unit: 'percent' as const } : {}),
          },
        },
        7,
        i * 2,
        5,
        2,
        i + 1,
      ),
    ),
    card(
      {
        kind: 'figure',
        title: both(words.fr.fleetByState, words.en.fleetByState),
        source: {
          dataset: 'assets',
          product: 'center',
          group_by: ['state'],
          measures: [{ fn: 'count' }],
        },
        context: ['unit'],
        figure: { chart: 'pie', drill: true },
      },
      0,
      5,
      4,
      4,
      3,
    ),
    card(
      {
        kind: 'figure',
        title: both(words.fr.fleetByUnit, words.en.fleetByUnit),
        source: {
          dataset: 'assets',
          product: 'center',
          group_by: ['unit_id'],
          measures: [{ fn: 'count' }],
        },
        figure: { chart: 'tilemap', drill: true },
      },
      4,
      5,
      4,
      4,
      4,
    ),
    card(
      {
        kind: 'figure',
        title: both(words.fr.waiting, words.en.waiting),
        source: {
          dataset: 'holdings',
          product: 'center',
          group_by: ['object_kind'],
          measures: [{ fn: 'sum', field: 'open' }],
        },
        context: ['unit'],
        figure: { chart: 'pareto' },
      },
      8,
      5,
      4,
      4,
      5,
    ),
    card(
      {
        kind: 'figure',
        title: both(words.fr.money, words.en.money),
        source: {
          dataset: 'money',
          product: 'center',
          group_by: ['month'],
          measures: [{ fn: 'sum', field: 'amount' }, { fn: 'count' }],
        },
        filters: [{ field: 'kind', op: 'eq', value: 'invoiced' }],
        context: ['project', 'unit'],
        figure: { chart: 'combo', unit: 'money' },
      },
      0,
      9,
      6,
      4,
      6,
    ),
    card(
      {
        kind: 'figure',
        title: both(words.fr.cumulative, words.en.cumulative),
        source: {
          dataset: 'money',
          product: 'center',
          group_by: ['month'],
          measures: [{ fn: 'sum', field: 'amount' }],
        },
        filters: [{ field: 'kind', op: 'eq', value: 'invoiced' }],
        context: ['project', 'unit'],
        figure: { chart: 'cumulative', unit: 'money' },
      },
      6,
      9,
      6,
      4,
      7,
    ),
  ];
  return {
    kind: 'board',
    title: both(words.fr.steering, words.en.steering),
    board: { cards, modes: ['grid', 'phone'], cross_filter: true },
  };
}

/** The default view of a place, or none. */
export async function defaultViewOf(db: SqlExecutor, place: string): Promise<View | null> {
  if (place === 'board:steering') return steering(db);
  return null;
}
