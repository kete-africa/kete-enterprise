import type { SqlExecutor } from '@kete/tenancy';
import { closeThread } from '@kete/threads';
import { kindsOf } from '../objects/index.js';
import type { KeteEventRow } from './events.js';

// An object's life (spec 107; doctrine D-062, R12): when an object reaches a state its kind calls
// closed — a project closed, a ticket solved, an asset retired — its thread is put away with it:
// kept, readable, nothing more said in it. If the object opens again, so does its thread.

/** Whether a state of a kind is a closed one. */
async function closedStates(db: SqlExecutor, kind: string): Promise<Set<string>> {
  const found = (await kindsOf(db)).find((k) => k.kind === kind);
  return new Set((found?.states ?? []).filter((s) => s.closed).map((s) => s.id));
}

/** The life consumer of the event path: an object's change of state, its thread follows. */
export async function followLife(db: SqlExecutor, event: KeteEventRow): Promise<void> {
  if (event.type !== 'object.state_changed' || !event.object) return;
  const closed = await closedStates(db, event.object.kind);
  const from = String(event.data['from'] ?? '');
  const to = String(event.data['to'] ?? '');
  // A thread merged into another stays where it went.
  const { rows } = await db.query<{ thread_id: string; state: string }>(
    `select thread_id, state from kete_threads where kind = 'object' and object_kind = $1
       and object_id = $2 and merged_into is null`,
    [event.object.kind, event.object.id],
  );
  for (const thread of rows) {
    if (closed.has(to) && thread.state === 'open') await closeThread(db, thread.thread_id);
    if (closed.has(from) && !closed.has(to) && thread.state === 'closed') {
      await db.query(
        `update kete_threads set state = 'open', closed_at = null where thread_id = $1`,
        [thread.thread_id],
      );
    }
  }
}
