import type { SqlExecutor } from '@kete/tenancy';
import { reportingLines } from '../structure/index.js';
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

  const lines = await reportingLines(db, input.asOf);

  return people
    .map((person) => {
      const about =
        input.about === 'manager'
          ? lines.managersOf(person.personId)
          : input.about === 'reports'
            ? lines.reportsOf(person.personId)
            : input.about === 'person'
              ? person.personId === input.aboutPersonId
                ? []
                : [input.aboutPersonId]
              : [null];
      return { personId: person.personId, name: person.name, email: person.email, about };
    })
    .filter((drawn) => drawn.about.length > 0);
}
