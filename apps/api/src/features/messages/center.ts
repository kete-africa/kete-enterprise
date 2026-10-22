import { extract } from '@kete/ai';
import type { Reading, Received, RouterOptions } from '@kete/channels';
import type { SqlExecutor } from '@kete/tenancy';
import { openThread, postMessage, threadsOf, type Holder } from '@kete/threads';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { organizationLanguageModel } from '../../platform/models.js';
import { usageStore } from '../../platform/usage.js';
import { phoneKey } from '../parties/index.js';
import { centerStructure } from '../work/index.js';
import { messageWords } from './words.js';

// The router as the center uses it (spec 089, FR-002): who settles what nobody could place (the
// organization's head, else its assistant), who holds an object's thread (a project's lead), the
// clients the center knows by their phone or e-mail, and the model's reading when one is set.

const INTENTS = [
  'incident',
  'quote_request',
  'invoice_request',
  'client_message',
  'other',
] as const;

let modelOverride: LanguageModel | null | undefined;
/** Tests: read with another model (`null`: as if none were configured). */
export function useRouterModel(next: LanguageModel | null | undefined): void {
  modelOverride = next;
}

/** Who settles the cards « à classer »: the head of the organization, else its assistant. */
async function triageOf(db: SqlExecutor): Promise<Holder> {
  const { head } = await centerStructure(db);
  return head ? { kind: 'person', id: head } : { kind: 'agent', id: 'agt_assistant' };
}

/** A client the center knows by her phone's last eight digits or her e-mail: her open project. */
async function knownClient(db: SqlExecutor, received: Received) {
  const phone = phoneKey(received.from.phone);
  const { rows } = await db.query<{ party_id: string; projects: string[] }>(
    `select p.party_id,
            array(select project_id from projects j
                   where j.party_id = p.party_id and j.status = 'open' order by j.project_id) as projects
       from parties p
      where p.status = 'active'
        and (($1::text is not null and p.phone_key = $1)
             or ($2::text is not null and lower(p.email) = $2))
      order by p.party_id limit 2`,
    [phone, received.from.address],
  );
  // Two parties with the same contact: not sure, a person decides.
  if (rows.length !== 1 || !rows[0]) return null;
  const { party_id, projects } = rows[0];
  return {
    object:
      projects.length === 1 && projects[0]
        ? { kind: 'project', id: projects[0] }
        : { kind: 'party', id: party_id },
    intent: 'client_message',
  };
}

const read = z.object({
  intent: z.enum(INTENTS),
  projectId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

/** The model's reading of what nobody knows: its intent, the open project it names, how sure. */
async function readByModel(
  db: SqlExecutor,
  organizationId: string,
  received: Received,
): Promise<Reading | null> {
  const model = modelOverride !== undefined ? modelOverride : organizationLanguageModel();
  if (!model) return null;
  const { rows: projects } = await db.query<{ project_id: string; name: string }>(
    `select project_id, name from projects where status = 'open' order by name limit 50`,
  );
  const { value } = await extract({
    model,
    schema: read,
    system:
      'Tu lis un message reçu par une entreprise et tu dis de quoi il s’agit : incident, ' +
      'quote_request (demande de devis), invoice_request (demande de facture), client_message, ' +
      'other. Si le message parle clairement d’un des projets de la liste, donne son identifiant ; ' +
      'sinon null. confidence : à quel point tu es sûr, de 0 à 1. Ne devine pas.',
    prompt: `Projets ouverts :\n${projects.map((p) => `- ${p.project_id} « ${p.name} »`).join('\n') || '(aucun)'}\n\nDe : ${received.from.name ?? received.from.key}\nObjet : ${received.subject ?? ''}\n\n${received.text.slice(0, 4000)}`,
    metering: {
      store: usageStore(),
      context: {
        organizationId,
        actor: { kind: 'agent', id: 'agt_assistant', channel: 'worker' },
        purpose: 'message-routing',
        model: '',
      },
    },
  });
  const known = projects.some((p) => p.project_id === value.projectId);
  return {
    intent: value.intent,
    ...(known && value.projectId ? { object: { kind: 'project', id: value.projectId } } : {}),
    confidence: value.confidence,
  };
}

/** The router's options for an organization, read in its transaction. */
export async function centerRouter(
  db: SqlExecutor,
  organizationId: string,
): Promise<RouterOptions> {
  const triage = await triageOf(db);
  return {
    triage,
    known: (received) => knownClient(db, received),
    read: (received) => readByModel(db, organizationId, received),
    threshold: 0.8,
    // A mail read from a Sent folder is its person's: by her box's address, else her own email.
    authorOf: async (received) => {
      const address = received.from.address?.toLowerCase();
      if (!address) return null;
      const { rows } = await db.query<{ user_id: string }>(
        `select user_id from mailbox_accounts where lower(address) = $1
         union all
         select account_user_id from people where lower(email) = $1 and account_user_id is not null
         limit 1`,
        [address],
      );
      return rows[0] ? { kind: 'person', id: rows[0].user_id } : null;
    },
    threadFor: async (object) => {
      if (object.kind === 'project') {
        const { rows } = await db.query<{ name: string; lead_user_id: string }>(
          `select name, lead_user_id from projects where project_id = $1`,
          [object.id],
        );
        if (rows[0])
          return { title: rows[0].name, holder: { kind: 'person', id: rows[0].lead_user_id } };
      }
      if (object.kind === 'party') {
        const { rows } = await db.query<{ name: string }>(
          `select name from parties where party_id = $1`,
          [object.id],
        );
        if (rows[0]) return { title: rows[0].name, holder: triage };
      }
      return { title: `${object.kind} ${object.id}`, holder: triage };
    },
  };
}

/** Her thread with Kete: opened the first time she needs it. */
export async function keteThreadOf(db: SqlExecutor, organizationId: string, userId: string) {
  const me = { kind: 'person', id: userId } as const;
  const mine = (await threadsOf(db, me)).find((t) => t.kind === 'kete' && t.holder.id === userId);
  return (
    mine ??
    openThread(db, organizationId, { kind: 'kete', title: messageWords().keteThread, holder: me })
  );
}

/**
 * Kete writes in her thread « Kete » (D-057): the morning point, once a day — what was already said
 * today is not said again.
 */
export async function writeToKete(
  db: SqlExecutor,
  organizationId: string,
  userId: string,
  text: string,
  now = new Date(),
): Promise<boolean> {
  const thread = await keteThreadOf(db, organizationId, userId);
  const { rows } = await db.query(
    `select 1 from kete_messages
      where thread_id = $1 and author_kind = 'agent' and author_id = 'agt_briefing'
        and at >= date_trunc('day', $2::timestamptz)`,
    [thread.id, now],
  );
  if (rows.length > 0) return false;
  await postMessage(
    db,
    organizationId,
    {
      thread: thread.id,
      author: { kind: 'agent', id: 'agt_briefing' },
      text: text.slice(0, 20000),
      for: 'information',
      via: 'kete',
    },
    now,
  );
  return true;
}
