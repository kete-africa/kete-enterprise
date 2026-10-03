import type { SqlExecutor } from '@kete/tenancy';
import { holdersAt, readChart } from './infrastructure/structure.tables.js';

export interface ReportingLines {
  /** Whoever holds — as primary or interim — the position hers reports to, past vacant ones. */
  managersOf(personId: string): string[];
  /** The holders of the positions that report to hers. */
  reportsOf(personId: string): string[];
  /** The positions she holds at that date. */
  positionsOf(personId: string): string[];
}

/**
 * The reporting lines at a date, drawn from positions and their holders (spec 002): the manager of
 * a person is never written on her, it is found where her position reports to. Surveys (spec 011)
 * and reviews (spec 012) ask the same question and get the same answer.
 */
export async function reportingLines(db: SqlExecutor, asOf: string): Promise<ReportingLines> {
  const holders = await holdersAt(db, asOf);
  const reportsTo = new Map<string, string | null>();
  const holdersOf = new Map<string, string[]>();
  const positionsOf = new Map<string, string[]>();
  for (const row of holders) {
    reportsTo.set(row.positionId, row.reportsTo);
    if (!row.personId) continue;
    holdersOf.set(row.positionId, [...(holdersOf.get(row.positionId) ?? []), row.personId]);
    positionsOf.set(row.personId, [...(positionsOf.get(row.personId) ?? []), row.positionId]);
  }
  return {
    managersOf(personId) {
      const found = new Set<string>();
      for (const position of positionsOf.get(personId) ?? []) {
        let above = reportsTo.get(position) ?? null;
        const seen = new Set<string>();
        while (above && !seen.has(above)) {
          seen.add(above);
          const holding = (holdersOf.get(above) ?? []).filter((h) => h !== personId);
          if (holding.length > 0) {
            holding.forEach((h) => found.add(h));
            break;
          }
          above = reportsTo.get(above) ?? null;
        }
      }
      return [...found];
    },
    reportsOf(personId) {
      const mine = new Set(positionsOf.get(personId) ?? []);
      const found = new Set<string>();
      for (const [position, parent] of reportsTo) {
        if (parent && mine.has(parent)) {
          (holdersOf.get(position) ?? [])
            .filter((h) => h !== personId)
            .forEach((h) => found.add(h));
        }
      }
      return [...found];
    },
    positionsOf(personId) {
      return positionsOf.get(personId) ?? [];
    },
  };
}

/** The manager of a person holding a given position: past vacancies, as for anyone. */
export async function managerOfPosition(
  db: SqlExecutor,
  asOf: string,
  personId: string,
  positionId: string,
): Promise<string | null> {
  const holders = await holdersAt(db, asOf);
  const reportsTo = new Map(holders.map((h) => [h.positionId, h.reportsTo]));
  let above = reportsTo.get(positionId) ?? null;
  const seen = new Set<string>();
  while (above && !seen.has(above)) {
    seen.add(above);
    const holding = holders.filter(
      (h) => h.positionId === above && h.personId && h.personId !== personId,
    );
    if (holding[0]?.personId) return holding[0].personId;
    above = reportsTo.get(above) ?? null;
  }
  return null;
}

/**
 * The organization at a date as one read: its units, positions, people, and who holds each
 * position (primary or interim). The directory (spec 023) answers from it.
 */
export async function readChartAt(db: SqlExecutor, asOf: string) {
  const [chart, holders] = await Promise.all([readChart(db, asOf), holdersAt(db, asOf)]);
  return {
    asOf,
    units: chart.units,
    positions: chart.positions,
    people: chart.people,
    holders,
  };
}
