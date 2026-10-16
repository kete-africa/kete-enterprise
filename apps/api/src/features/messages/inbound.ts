import { fromChat, route } from '@kete/channels';
import type { ChatHeardMessage } from '@kete/notify';
import { queueChatReply } from '@kete/notify';
import { postMessage } from '@kete/threads';
import { transaction } from '../../platform/db.js';
import { centerRouter, keteThreadOf } from './center.js';
import { messageWords } from './words.js';

// What arrives on the organization's WhatsApp or Telegram without a button (spec 089, FR-003): from
// someone outside, it is routed into its object's thread and acknowledged; from a person of the
// center, it lands in her thread « Kete ». A message delivered twice is heard once.

export async function hearFromOutside(heard: ChatHeardMessage): Promise<void> {
  const words = messageWords();
  await transaction(heard.organizationId, async (db) => {
    const received = fromChat(heard.message);
    if (heard.reference) {
      const thread = await keteThreadOf(db, heard.organizationId, heard.reference);
      await postMessage(db, heard.organizationId, {
        thread: thread.id,
        author: { kind: 'person', id: heard.reference },
        text: received.text,
        for: 'information',
        via: received.via,
      });
      await queueChatReply(db, heard.organizationId, { to: heard.messageId, text: words.noted });
      return;
    }
    await route(db, heard.organizationId, received, await centerRouter(db, heard.organizationId));
    await queueChatReply(db, heard.organizationId, { to: heard.messageId, text: words.received });
  });
}
