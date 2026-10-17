import type { SqlExecutor } from '@kete/tenancy';
import { openHoldings, syncSource } from '@kete/work';
import { draftsFor } from '../gateway/index.js';
import { notificationWords } from '../notifications/index.js';
import { openItems, APP, type Said } from './sources.js';
import { centerStructure } from './structure.js';

// The sync (spec 087, FR-001): every open item of the six sources said as a holding, the holdings
// whose item closed finished (`syncSource`, as the apps' holdings are kept — spec 091). It runs
// each minute and before « Pour moi » is read; a source that writes its holding itself (decision
// 0002) leaves it.

const keyOf = (source: { kind: string; ref: string }) => `${source.kind}:${source.ref}`;

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

  return syncSource(db, organizationId, { app: APP, said: all, now });
}
