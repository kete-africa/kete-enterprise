import type { SqlExecutor } from '@kete/tenancy';
import { sayHolding } from '@kete/work';
import { randomUUID } from 'node:crypto';
import { getPool, transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { listIndicators, readIndicator, type Indicator, type Reading } from './measure.js';
import { measureWords } from './words.js';

// A colour has a consequence (spec 102, FR-006; D-062, R11, R17; ADR 0015): when the organization's
// figure turns red — past its threshold, or missing — its owner receives a holding « action
// corrective » with the figure and its proof, once per turn to red, and the event path says it.
// Only a reading of the whole organization counts: a person's own sight is not the organization's.

type Identity = IdentityVariables['identity'];

/** Who holds the indicator's owning position today: the person's account. */
async function ownerOf(db: SqlExecutor, positionId: string): Promise<string | null> {
  const { rows } = await db.query<{ account_user_id: string | null }>(
    `select p.account_user_id from assignments a join people p on p.person_id = a.person_id
      where a.position_id = $1 and a.starts_on <= current_date
        and (a.ends_on is null or a.ends_on >= current_date) and a.kind in ('primary', 'interim')
      order by a.kind = 'primary' desc limit 1`,
    [positionId],
  );
  return rows[0]?.account_user_id ?? null;
}

const shown = (value: number | null, unit: string | null) =>
  value === null ? null : `${value.toLocaleString('fr-FR')}${unit === 'percent' ? ' %' : ''}`;

/**
 * Keeps an organization-wide reading's colour; turning red, its owner gets a holding and the event
 * path says it. Answers the holding made, if one was.
 */
export async function considerColour(
  db: SqlExecutor,
  organizationId: string,
  indicator: Indicator,
  reading: Reading,
): Promise<string | null> {
  if (Object.keys(reading.provenance.filter).length > 0) return null;
  if (reading.status === 'denied' || reading.status === 'refused') return null;
  if (reading.status === 'typed') return null;
  const colour = reading.colour;
  const { rows } = await db.query<{ colour: string | null; holding_id: string | null }>(
    `select colour, holding_id from indicator_colours where indicator_id = $1`,
    [indicator.indicatorId],
  );
  const before = rows[0]?.colour ?? null;
  let holdingId: string | null = null;
  const turnedRed = colour === 'red' && before !== 'red';
  if (turnedRed && indicator.ownerPositionId) {
    const owner = await ownerOf(db, indicator.ownerPositionId);
    if (owner) {
      const words = measureWords();
      const holding = await sayHolding(db, organizationId, {
        source: {
          app: 'measure',
          kind: 'indicator',
          // One holding per turn to red: a later turn is a new one.
          ref: `${indicator.indicatorId}:${reading.provenance.at}`,
        },
        object: { kind: 'indicator', id: indicator.indicatorId },
        what:
          reading.status === 'missing'
            ? words.correctiveMissing(indicator.name, reading.provenance.source)
            : words.corrective(
                indicator.name,
                shown(reading.value, indicator.unit) ?? '',
                shown(indicator.threshold, indicator.unit) ?? '',
                reading.provenance.source,
              ),
        holder: { kind: 'person', id: owner },
        state: 'held',
        for: 'action',
        priority: 'high',
        href: `/indicateurs?indicateur=${encodeURIComponent(indicator.indicatorId)}`,
      });
      holdingId = holding.holdingId;
    }
  }
  if (turnedRed) {
    await db.query(
      `insert into kete_events (organization_id, event_id, source, product, type, object_kind,
         object_id, label, data)
       values ($1, $2, 'measure', 'center', 'indicator.turned_red', 'indicator', $3, $4, $5)`,
      [
        organizationId,
        `evt_${randomUUID()}`,
        indicator.indicatorId,
        indicator.name.slice(0, 300),
        JSON.stringify({
          value: reading.value,
          threshold: indicator.threshold,
          missing: reading.status === 'missing',
          source: reading.provenance.source,
        }),
      ],
    );
  }
  await db.query(
    `insert into indicator_colours (organization_id, indicator_id, colour, value, missing, read_at,
       holding_id)
     values ($1, $2, $3, $4, $5, now(), $6)
     on conflict (organization_id, indicator_id) do update
       set colour = excluded.colour, value = excluded.value, missing = excluded.missing,
           read_at = now(), holding_id = coalesce(excluded.holding_id, indicator_colours.holding_id)`,
    [
      organizationId,
      indicator.indicatorId,
      colour,
      reading.value,
      reading.status === 'missing',
      holdingId,
    ],
  );
  return holdingId;
}

/** The quarter so far: what an indicator watched by the worker is read over. */
export function quarterSoFar(today: Date): { from: string; to: string } {
  const month = Math.floor(today.getUTCMonth() / 3) * 3;
  const from = new Date(Date.UTC(today.getUTCFullYear(), month, 1));
  return { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

/**
 * The worker, every quarter of an hour: the indicators with an owner and a rule, sourced in the
 * center, read for the whole organization over the quarter so far. An app's figures need a person's
 * token: they are considered when an administrator reads them.
 */
export async function watchIndicators(now = new Date()): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string }>(
    'select organization_id from kete_measure_watched()',
  );
  let turned = 0;
  for (const { organization_id: organizationId } of rows) {
    // The worker reads as the organization: the whole of it, never a person's sight.
    const system: Identity = {
      userId: 'svc_measure',
      email: '',
      name: 'Kete',
      organizationId,
      role: 'admin',
      apps: {},
      twoFactor: false,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    };
    await transaction(organizationId, async (db) => {
      for (const indicator of await listIndicators(db)) {
        if (indicator.source?.kind !== 'center' || !indicator.ownerPositionId) continue;
        if (indicator.direction === null) continue;
        const reading = await readIndicator(
          { db, identity: system, token: null, now: () => now },
          indicator,
          { period: quarterSoFar(now) },
        );
        if (await considerColour(db, organizationId, indicator, reading)) turned += 1;
      }
    }).catch((error: unknown) => console.error(`[measure] ${organizationId}`, error));
  }
  return turned;
}
