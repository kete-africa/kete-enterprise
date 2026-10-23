import type { SqlExecutor } from '@kete/tenancy';
import { messagesPage } from '@kete/threads';
import type { IdentityVariables } from '../../platform/identity.js';
import { objectCard } from '../objects/index.js';

// What an agent knows of the object its task is about (spec 104; doctrine D-062, R1, R4; kete-core
// ADR 0018): the object's card — its state, its four axes, its named links — and the last words of
// its thread, read with its person's rights: what she would see, never more.

type Identity = IdentityVariables['identity'];

/** The object a task was given in: its thread's object, if it has one. */
async function objectOfTask(db: SqlExecutor, taskId: string) {
  const { rows } = await db.query<{
    thread_id: string;
    object_kind: string | null;
    object_id: string | null;
  }>(
    `select t.thread_id, t.object_kind, t.object_id from agent_task_threads x
       join kete_threads t on t.thread_id = x.thread_id
      where x.task_id = $1 and t.kind = 'object' limit 1`,
    [taskId],
  );
  const row = rows[0];
  return row?.object_kind && row.object_id
    ? { threadId: row.thread_id, kind: row.object_kind, id: row.object_id }
    : null;
}

/** The object's context, as words for the agent's prompt; empty when the task has no object. */
export async function objectContextFor(
  db: SqlExecutor,
  identity: Identity,
  taskId: string,
): Promise<string> {
  const object = await objectOfTask(db, taskId);
  if (!object) return '';
  const card = await objectCard(db, identity, object.kind, object.id);
  if (!card) return '';
  const o = card.object;
  const lines = [
    `L’objet de cette tâche : ${o.title} (${o.kind}${o.stateLabel ? `, ${o.stateLabel}` : ''}).`,
    ...card.links.map((l) => `- ${l.label} : ${l.object.title} (${l.object.kind})`),
    ...card.holdings.map((h) => `- en cours : ${h.what}${h.due ? ` (échéance ${h.due})` : ''}`),
  ];
  const { messages } = await messagesPage(db, object.threadId, {
    viewer: { kind: 'person', id: identity.userId },
    limit: 10,
  });
  const said = messages
    .filter((m) => !m.deleted)
    .map((m) => `- ${m.author.kind === 'agent' ? 'agent' : 'personne'} : ${m.text.slice(0, 300)}`);
  if (said.length) lines.push('Les derniers mots de son fil :', ...said);
  return lines.join('\n');
}
