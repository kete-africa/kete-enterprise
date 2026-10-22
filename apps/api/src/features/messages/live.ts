import { changesSince, listenThreads, type ThreadChange } from '@kete/threads';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import pg from 'pg';
import { transaction } from '../../platform/db.js';
import { env } from '../../platform/env.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';

// Threads, live (spec 098, FR-004): one listener per process on Postgres' announcements
// (`@kete/threads`, `listenThreads`), and one Server-Sent Events stream per open screen, told of each
// change in a thread its person reads. Where Postgres cannot be listened to (a transaction pooler),
// each stream asks what changed every few seconds instead (`changesSince`). The screen then reads
// the thread again: what it shows always comes from the API, never from the stream.

type Identity = IdentityVariables['identity'];
interface Listener {
  organizationId: string;
  userId: string;
  admin: boolean;
  send: (change: ThreadChange) => void;
}

const listeners = new Set<Listener>();
let mode: 'listening' | 'polling' | null = null;
let starting: Promise<void> | null = null;

/** Starts the process' listener once; falls back to polling when Postgres cannot be listened to. */
function start(): Promise<void> {
  starting ??= (async () => {
    try {
      const client = new pg.Client({ connectionString: env.databaseUrl });
      client.on('error', () => {
        mode = 'polling';
      });
      await client.connect();
      await listenThreads(client, (change) => {
        for (const listener of listeners) {
          if (listener.organizationId === change.organizationId) listener.send(change);
        }
      });
      mode = 'listening';
    } catch {
      mode = 'polling';
    }
  })();
  return starting;
}

async function reads(identity: Identity, admin: boolean, threadId: string): Promise<boolean> {
  if (admin) return true;
  const { rows } = await transaction(identity.organizationId, (db) =>
    db.query(
      `select 1 from kete_thread_members
        where thread_id = $1 and member_kind = 'person' and member_id = $2 and until is null`,
      [threadId, identity.userId],
    ),
  );
  return rows.length > 0;
}

/** `GET /v1/threads/events`: what changes in her threads, as it happens. */
export function threadEvents(c: Context<{ Variables: IdentityVariables }>) {
  const identity = c.get('identity');
  const admin = isAdministrator(identity);
  return streamSSE(c, async (stream) => {
    await start();
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    const listener: Listener = {
      organizationId: identity.organizationId,
      userId: identity.userId,
      admin,
      send: (change) => {
        void reads(identity, admin, change.threadId).then((yes) => {
          if (yes && open) {
            void stream.writeSSE({
              event: 'thread',
              data: JSON.stringify({
                threadId: change.threadId,
                kind: change.kind,
                ...(change.who ? { who: change.who } : {}),
              }),
            });
          }
        });
      },
    };
    listeners.add(listener);
    let since = new Date();
    try {
      for (let beat = 0; open; beat += 1) {
        await stream.sleep(mode === 'polling' ? 4000 : 25_000);
        if (!open) break;
        if (mode === 'polling') {
          const now = new Date();
          const changed = await transaction(identity.organizationId, (db) =>
            changesSince(db, { kind: 'person', id: identity.userId }, since),
          );
          since = now;
          for (const threadId of changed) {
            await stream.writeSSE({
              event: 'thread',
              data: JSON.stringify({ threadId, kind: 'message' }),
            });
          }
        }
        // A beat keeps proxies from closing a quiet stream.
        await stream.writeSSE({ event: 'beat', data: String(beat) });
      }
    } finally {
      listeners.delete(listener);
    }
  });
}
