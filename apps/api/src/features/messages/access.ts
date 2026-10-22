import type { Thread } from '@kete/sdk';
import type { SqlExecutor } from '@kete/tenancy';
import { getThread, ThreadError } from '@kete/threads';
import { GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { isAdministrator } from '../rights/index.js';

// Who may read and change a thread, and how a refusal of `@kete/threads` reaches the screen.

type Identity = IdentityVariables['identity'];

export const me = (identity: Identity) => ({ kind: 'person' as const, id: identity.userId });

/** Kete itself, as a member of a thread: the assistant acting for whoever asks it. */
export const KETE = { kind: 'agent' as const, id: 'agt_assistant' };

export function refuse(error: unknown): never {
  if (error instanceof ThreadError) {
    const status = {
      not_found: 404,
      closed: 409,
      already_edited: 409,
      already_moved: 409,
      not_the_author: 403,
      not_a_member: 403,
      invalid_thread: 422,
      invalid_message: 422,
      file_too_large: 422,
    } as const;
    throw new GestureRefusal(status[error.code], error.code, error.message);
  }
  throw error;
}

/** A thread is read by its members now, and by the administrators. */
export async function readable(db: SqlExecutor, identity: Identity, threadId: string) {
  const thread = await getThread(db, threadId);
  if (!thread) throw new GestureRefusal(404, 'not_found', 'No such thread here.');
  const member = (thread.members ?? []).some(
    (m) => m.kind === 'person' && m.id === identity.userId && !m.until,
  );
  if (!member && !isAdministrator(identity)) {
    throw new GestureRefusal(403, 'not_a_member', 'Only its members read a thread.');
  }
  return thread;
}

/** Its holder, or an administrator, changes who is in a thread. */
export function mayManage(identity: Identity, thread: Thread) {
  const holds = thread.holder.kind === 'person' && thread.holder.id === identity.userId;
  if (!holds && !isAdministrator(identity)) {
    throw new GestureRefusal(403, 'not_the_holder', 'Its holder changes who is in a thread.');
  }
}
