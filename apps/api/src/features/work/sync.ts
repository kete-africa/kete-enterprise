import type { SqlExecutor } from '@kete/tenancy';
import { finishHolding, openHoldings, sayHolding, type Holding } from '@kete/work';
import { draftsFor } from '../gateway/index.js';
import { notificationWords } from '../notifications/index.js';
import { openItems, APP, type Said } from './sources.js';
import { centerStructure } from './structure.js';

// The sync (spec 087, FR-001): every open item of the six sources said as a holding, the holdings
// whose item closed finished. It runs each minute and before « Pour moi » is read; a source that
// writes its holding itself (decision 0002) leaves it.

const keyOf = (source: { kind: string; ref: string }) => `${source.kind}:${source.ref}`;

/** Whether what a source says now is what the holding already keeps: nothing to write. */
function unchanged(kept: Holding, said: Said): boolean {
  return (
    kept.what === said.what &&
    kept.holder.kind === said.holder.kind &&
    kept.holder.id === said.holder.id &&
    kept.state === said.state &&
    (kept.waitingOn?.id ?? null) === (said.waiting_on?.id ?? null) &&
    kept.due === (said.due ?? null) &&
    kept.object.kind === said.object.kind &&
    kept.object.id === said.object.id
  );
}

export async function syncHoldings(
  db: SqlExecutor,
  organizationId: string,
  now = new Date(),
): Promise<{ said: number; finished: number }> {
  const { head } = await centerStructure(db, now);
  const { items, drafts } = await openItems(db, head);
  const kept = new Map((await openHoldings(db, { app: APP })).map((h) => [keyOf(h.source), h]));

  // A new draft is named by what its capability does, as she reviews it.
  const described = new Map<string, string>();
  const fresh = new Set(
    drafts.filter((d) => !kept.has(keyOf(d.said.source))).map((d) => d.forUser),
  );
  for (const userId of fresh) {
    try {
      for (const review of await draftsFor({ organizationId, userId })) {
        described.set(review.draftId, review.description);
      }
    } catch (error) {
      console.error('[work] drafts not described', (error as Error).message);
    }
  }
  const words = notificationWords();
  const all: Said[] = [
    ...items,
    ...drafts.map(({ said: draft }) => ({
      ...draft,
      what:
        kept.get(keyOf(draft.source))?.what ??
        words.draftToCheck(described.get(draft.source.ref) ?? draft.what),
    })),
  ];

  let said = 0;
  const seen = new Set<string>();
  for (const item of all) {
    const key = keyOf(item.source);
    seen.add(key);
    const holding = kept.get(key);
    // The relay gave it to someone while its holder is away: the source still names the absent
    // holder, the holding keeps who stands in.
    const relayed =
      holding?.takenOverFrom &&
      holding.takenOverFrom.kind === item.holder.kind &&
      holding.takenOverFrom.id === item.holder.id;
    const next = relayed ? { ...item, holder: holding.holder } : item;
    if (holding && unchanged(holding, next)) continue;
    await sayHolding(db, organizationId, next, now);
    said += 1;
  }
  let finished = 0;
  for (const [key, holding] of kept) {
    if (seen.has(key)) continue;
    if (await finishHolding(db, organizationId, holding.holdingId, now)) finished += 1;
  }
  return { said, finished };
}
