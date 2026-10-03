import type { KeteIdentity } from '@kete/auth';
import type { SqlExecutor } from '@kete/tenancy';
import { covers, reach } from '../rights/index.js';
import { readChartAt, reportingLines } from '../structure/index.js';

// The directory (spec 023, kete-core spec 049): the organization as the team's apps read it, with
// the person's token — who she is, where she sits, who her manager is; a colleague or a unit, when
// her rights reach them. Names, work e-mails and positions only: never a phone number.

export interface DirectoryPerson {
  personId: string;
  name: string;
  email: string | null;
  /** Her Compte Kete account: what the apps know her by. */
  userId: string | null;
}

export interface DirectoryCard extends DirectoryPerson {
  positions: { positionId: string; title: string; unitId: string; unitName: string }[];
  /** Whoever holds the position hers reports to, past vacant ones, interim included. */
  managers: DirectoryPerson[];
  /** The holders of the positions that report to hers. */
  reports: DirectoryPerson[];
}

export interface DirectoryUnit {
  unitId: string;
  name: string;
  country: string | null;
  /** From the top of the organization down to its parent. */
  ancestors: { unitId: string; name: string }[];
  children: { unitId: string; name: string }[];
  people: (DirectoryPerson & { positionTitle: string })[];
}

const today = () => new Date().toISOString().slice(0, 10);

type ChartAt = Awaited<ReturnType<typeof readChartAt>>;

function personOf(chart: ChartAt, personId: string): DirectoryPerson | null {
  const p = chart.people.find((x) => x.personId === personId);
  return p ? { personId: p.personId, name: p.name, email: p.email, userId: p.accountUserId } : null;
}

async function cardOf(db: SqlExecutor, chart: ChartAt, personId: string): Promise<DirectoryCard> {
  const lines = await reportingLines(db, chart.asOf);
  const person = personOf(chart, personId);
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));
  const positions = lines.positionsOf(personId).flatMap((id) => {
    const position = chart.positions.find((p) => p.positionId === id);
    return position
      ? [
          {
            positionId: position.positionId,
            title: position.title,
            unitId: position.unitId,
            unitName: unitName.get(position.unitId) ?? '',
          },
        ]
      : [];
  });
  const people = (ids: string[]) =>
    ids.map((id) => personOf(chart, id)).filter((p): p is DirectoryPerson => p !== null);
  return {
    ...(person ?? { personId, name: '', email: null, userId: null }),
    positions,
    managers: people(lines.managersOf(personId)),
    reports: people(lines.reportsOf(personId)),
  };
}

/** The person behind the token, as the directory shows her; null when she is not in the chart. */
export async function myCard(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId'>,
  asOf = today(),
): Promise<DirectoryCard | null> {
  const chart = await readChartAt(db, asOf);
  const me = chart.people.find((p) => p.accountUserId === identity.userId);
  return me ? cardOf(db, chart, me.personId) : null;
}

/**
 * A colleague, by her Compte Kete account: seen by herself, her managers and reports, and whoever
 * holds « structure:read » over one of her units. Otherwise null, as if unknown.
 */
export async function colleagueCard(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
  userId: string,
  asOf = today(),
): Promise<DirectoryCard | null> {
  const chart = await readChartAt(db, asOf);
  const target = chart.people.find((p) => p.accountUserId === userId);
  if (!target) return null;
  const card = await cardOf(db, chart, target.personId);
  if (userId === identity.userId) return card;
  const linked = [...card.managers, ...card.reports].some((p) => p.userId === identity.userId);
  if (linked) return card;
  const scope = await reach(db, identity, 'structure:read', asOf);
  return card.positions.some((p) => covers(scope, p.unitId)) ? card : null;
}

/** A unit, its place and its people: for whoever belongs to it or reads the structure over it. */
export async function unitCard(
  db: SqlExecutor,
  identity: Pick<KeteIdentity, 'userId' | 'role'>,
  unitId: string,
  asOf = today(),
): Promise<DirectoryUnit | null> {
  const chart = await readChartAt(db, asOf);
  const unit = chart.units.find((u) => u.unitId === unitId);
  if (!unit) return null;
  const lines = await reportingLines(db, asOf);
  const me = chart.people.find((p) => p.accountUserId === identity.userId);
  const mine = me
    ? lines
        .positionsOf(me.personId)
        .some((id) => chart.positions.find((p) => p.positionId === id)?.unitId === unitId)
    : false;
  if (!mine && !covers(await reach(db, identity, 'structure:read', asOf), unitId)) return null;
  const byId = new Map(chart.units.map((u) => [u.unitId, u]));
  const ancestors: { unitId: string; name: string }[] = [];
  const seen = new Set<string>();
  for (let up = unit.parentId; up && !seen.has(up); up = byId.get(up)?.parentId ?? null) {
    seen.add(up);
    const parent = byId.get(up);
    if (parent) ancestors.unshift({ unitId: parent.unitId, name: parent.name });
  }
  const people: DirectoryUnit['people'] = [];
  for (const position of chart.positions.filter((p) => p.unitId === unitId)) {
    for (const holder of chart.holders.filter((h) => h.positionId === position.positionId)) {
      const person = holder.personId ? personOf(chart, holder.personId) : null;
      if (person) people.push({ ...person, positionTitle: position.title });
    }
  }
  return {
    unitId: unit.unitId,
    name: unit.name,
    country: unit.country,
    ancestors,
    children: chart.units
      .filter((u) => u.parentId === unitId)
      .map((u) => ({ unitId: u.unitId, name: u.name })),
    people,
  };
}
