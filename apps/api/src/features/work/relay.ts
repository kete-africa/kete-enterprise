import type pg from 'pg';
import type { SqlExecutor } from '@kete/tenancy';
import { dueNudges, reclaimUnheld, relayAbsences, type Holding, type Move } from '@kete/work';
import { notificationWords, tell } from '../notifications/index.js';
import { sourceKinds, type SourceKind } from './sources.js';
import { centerStructure } from './structure.js';
import { syncHoldings } from './sync.js';

// The relay's round (spec 087, FR-002): the sources first, then who is away, who left, what waits
// too long. Each new holder is told in her notifications; what nobody can take, the head is told.

const hrefOf = (holding: Holding) =>
  (sourceKinds[holding.source.kind as SourceKind] ?? (() => '/'))(holding.source.ref);

export interface RelayReport {
  said: number;
  finished: number;
  moved: number;
  stuck: number;
  nudged: number;
}

export async function relayRound(
  db: SqlExecutor,
  organizationId: string,
  now = new Date(),
): Promise<RelayReport> {
  const { said, finished } = await syncHoldings(db, organizationId, now);
  const center = await centerStructure(db, now);
  const words = notificationWords();
  const away = await relayAbsences(db, organizationId, {
    absences: center.absences,
    structure: center.structure,
    now,
  });
  const gone = await reclaimUnheld(db, organizationId, {
    isActive: center.isActive,
    personOfAgent: center.personOfAgent,
    structure: center.structure,
    now,
  });
  const told = async (move: Move) =>
    tell(db, organizationId, move.to.id, {
      kind: 'holding.taken_over',
      title:
        move.because === 'absence'
          ? words.holdingTakenOver(center.nameOf(move.from.id), move.holding.what)
          : words.holdingReclaimed(move.holding.what),
      href: hrefOf(move.holding),
    });
  for (const move of [...away.moved, ...gone.moved]) await told(move);
  const stuck = [...away.stuck, ...gone.stuck];
  if (center.head) {
    for (const holding of stuck) {
      if (holding.holder.id === center.head) continue;
      await tell(db, organizationId, center.head, {
        kind: 'holding.stuck',
        title: words.holdingStuck(holding.what),
        href: hrefOf(holding),
      });
    }
  }
  const nudges = await dueNudges(db, organizationId, { now });
  for (const nudge of nudges) {
    // A colleague is asked for her answer; a party outside, its holder is reminded to follow up.
    const person = nudge.to.kind === 'person' ? nudge.to.id : null;
    const to = person ?? (nudge.holding.holder.kind === 'person' ? nudge.holding.holder.id : null);
    if (!to) continue;
    await tell(db, organizationId, to, {
      kind: 'holding.nudged',
      title: person
        ? words.holdingNudge(nudge.holding.what)
        : words.holdingNudgeParty(nudge.holding.what),
      href: hrefOf(nudge.holding),
    });
  }
  return {
    said,
    finished,
    moved: away.moved.length + gone.moved.length,
    stuck: stuck.length,
    nudged: nudges.length,
  };
}

/** The organizations the relay goes through: those with people (the worker's round). */
export async function workOrganizations(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ organization_id: string }>(
    `select organization_id from work_organizations()`,
  );
  return rows.map((row) => row.organization_id);
}
