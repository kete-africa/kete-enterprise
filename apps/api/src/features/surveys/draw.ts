import type { SqlExecutor } from '@kete/tenancy';
import { holdersAt } from '../structure/index.js';
import { peopleAt, subtreeOf } from './infrastructure/surveys.tables.js';
import type { About, Audience } from './surveys.record.js';

export interface Drawn {
  personId: string | null;
  name: string;
  email: string | null;
  /** One form per entry: about nobody (null), or about that person. */
  about: (string | null)[];
}

/**
 * Who answers about whom, drawn from the structure at the campaign's opening (spec 011) and frozen
 * there. The manager of a person is whoever holds — as primary or interim — the position her
 * position reports to, climbing past vacant positions; her reports are the holders of the positions
 * that report to hers.
 */
export async function drawRespondents(
  db: SqlExecutor,
  input: { audience: Audience; about: About; aboutPersonId: string | null; asOf: string },
): Promise<Drawn[]> {
  if (input.audience.kind === 'outside') {
    return input.audience.people.map((p) => ({
      personId: null,
      name: p.name,
      email: p.email,
      about: [null],
    }));
  }
  let people = await peopleAt(db, input.asOf);
  if (input.audience.kind === 'units') {
    const units = await subtreeOf(db, input.audience.unitIds);
    people = people.filter((p) => p.unitIds.some((u) => units.has(u)));
  }

  const holders = await holdersAt(db, input.asOf);
  const reportsTo = new Map<string, string | null>();
  const holdersOf = new Map<string, string[]>();
  const positionsOf = new Map<string, string[]>();
  for (const row of holders) {
    reportsTo.set(row.positionId, row.reportsTo);
    if (!row.personId) continue;
    holdersOf.set(row.positionId, [...(holdersOf.get(row.positionId) ?? []), row.personId]);
    positionsOf.set(row.personId, [...(positionsOf.get(row.personId) ?? []), row.positionId]);
  }

  const managersOf = (personId: string): string[] => {
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
  };
  const reportsOf = (personId: string): string[] => {
    const mine = new Set(positionsOf.get(personId) ?? []);
    const found = new Set<string>();
    for (const [position, parent] of reportsTo) {
      if (parent && mine.has(parent)) {
        (holdersOf.get(position) ?? []).filter((h) => h !== personId).forEach((h) => found.add(h));
      }
    }
    return [...found];
  };

  return people
    .map((person) => {
      const about =
        input.about === 'manager'
          ? managersOf(person.personId)
          : input.about === 'reports'
            ? reportsOf(person.personId)
            : input.about === 'person'
              ? person.personId === input.aboutPersonId
                ? []
                : [input.aboutPersonId]
              : [null];
      return { personId: person.personId, name: person.name, email: person.email, about };
    })
    .filter((drawn) => drawn.about.length > 0);
}
