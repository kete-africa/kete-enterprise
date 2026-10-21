import { fromChat, fromMail, route } from '@kete/channels';
import { inOrganization } from '@kete/tenancy';
import { joinThread, openThread, postMessage, saveThreadFile } from '@kete/threads';
import type pg from 'pg';
import { centerRouter } from '../../src/features/messages/index.js';
import { centerStructure } from '../../src/features/work/index.js';

/**
 * The demo's threads (spec 090): Garage Bè writes on WhatsApp and lands in its project's thread,
 * held by its lead; a colleague asks her something there for action; a mail nobody knows waits
 * « à classer » with the organization's head; the direction has its group. As the router would
 * have done it, through the center's own router.
 */
export async function seedThreads(options: {
  app: pg.Pool;
  organizationId: string;
  colleague: string;
}): Promise<{ thread: string | null; triage: boolean }> {
  return inOrganization(options.app, options.organizationId, async (db) => {
    const router = await centerRouter(db, options.organizationId);
    const { head } = await centerStructure(db);
    const client = await route(
      db,
      options.organizationId,
      fromChat(
        {
          channel: 'whatsapp',
          providerMessageId: 'wamid.demo-garage-1',
          sender: {
            id: '22890004112',
            phone: '22890004112',
            address: '22890004112',
            username: null,
            displayName: 'Garage Bè',
          },
          kind: 'text',
          text: 'Bonjour, l’onduleur du garage s’est encore arrêté ce matin. Vous passez quand ?',
        },
        new Date(Date.now() - 2 * 3_600_000),
      ),
      router,
    );
    if (client.thread) {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      // The client's mail, so an answer « au client » can leave by mail too (spec 098).
      await joinThread(db, options.organizationId, client.thread, {
        kind: 'contact',
        id: 'mail:garage.be@demo.kya.tg',
      });
      const quote = await saveThreadFile(db, options.organizationId, {
        threadId: client.thread,
        name: 'Devis batteries Garage Bè.txt',
        mediaType: 'text/plain',
        content: new TextEncoder().encode(
          'Devis : 2 batteries 12 V 200 Ah — 420 000 F CFA ; pose et contrôle — 45 000 F CFA.',
        ),
        by: { kind: 'person', id: options.colleague },
      });
      await postMessage(
        db,
        options.organizationId,
        {
          thread: client.thread,
          author: { kind: 'person', id: options.colleague },
          text: 'Je peux y aller demain 9 h si tu valides le déplacement. Le devis des batteries est joint.',
          for: 'action',
          via: 'kete',
          attachments: [
            { id: quote.id, name: quote.name, media_type: quote.media_type, bytes: quote.bytes },
          ],
        },
        new Date(),
        { due: tomorrow, priority: 'high' },
      );
    }
    const unknown = await route(
      db,
      options.organizationId,
      await fromMail(
        [
          'From: Hôtel Oti <contact@hotel-oti.tg>',
          'To: sav@kya.tg',
          'Subject: Demande de devis — kit solaire 3 kW, Sokodé',
          'Message-ID: <demo-oti-1@hotel-oti.tg>',
          `Date: ${new Date(Date.now() - 50 * 60_000).toUTCString()}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          'Bonjour, nous voulons équiper notre hôtel de 24 chambres. Pouvez-vous nous faire un devis ?',
        ].join('\r\n'),
      ),
      router,
    );
    if (head) {
      const direction = await openThread(db, options.organizationId, {
        kind: 'group',
        title: 'Comité de direction',
        holder: { kind: 'person', id: head },
        members: [{ kind: 'person', id: options.colleague }],
      });
      await postMessage(db, options.organizationId, {
        thread: direction.id,
        author: { kind: 'person', id: head },
        text: 'Ordre du jour de jeudi : trésorerie, chantier Garage Bè, recrutement SAV.',
        for: 'information',
        via: 'kete',
      });
    }
    return { thread: client.thread ?? null, triage: Boolean(unknown.asked) };
  });
}
