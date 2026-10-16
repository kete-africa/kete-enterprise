# Phone

The center on WhatsApp and Telegram (spec 077), on `@kete/notify`'s chat outbox.

- `listenForPhones` — when a request reaches someone's step (`onWaiting`), a message with two
  buttons (`approve:<requestId>`, `refuse:<requestId>`) is queued to each approver whose phone is
  tied and who agreed.
- `phoneWebhookRoutes` — `/public/chat/whatsapp` and `/public/chat/telegram/:account`: each
  checked with the organization's own secret; a tap runs `decide-request` as the person, through
  her channel, keyed by the provider's message id (decided once), `administrator: false`.
- `phoneRoutes` — `/v1/phone`: her phone tied or untied by her; `/v1/phone/senders`: the
  organization's number and bot, by an administrator.
- `deliverPhones` — the worker's job `send-phones`, every minute.
- Words without a button (spec 089): from someone outside, routed into its object's thread and
  acknowledged; from a person of the center, kept in her thread « Kete » (`features/messages`).
