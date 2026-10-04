# Spec 030 — Notifications and search

## Why

« A decision waiting reaches its person's phone. » What happens for a person reaches her in Kete
Enterprise and on her devices, even closed — with the browsers' standard, Web Push, through
`@kete/notify` (kete-core spec 055). And one question finds, across everything she may see, the
conversation, the action, the decision, the colleague, the app or the document she needs.

## The flow

```mermaid
sequenceDiagram
  participant P as Person (browser)
  participant E as Kete Enterprise
  participant N as @kete/notify
  participant S as Push service
  P->>E: Notifications › « Recevoir sur cet appareil » (service worker, PushManager)
  E->>N: savePushSubscription
  Note over E: a request reaches her step · an app puts a task in her To do<br/>her scheduled task answered · her agent raised a signal
  E->>N: notify (in the gesture's transaction)
  N->>S: Web Push (VAPID)
  S-->>P: the notification, even closed; a tap opens its page
  P->>E: /recherche?q=…
  E->>E: the features' own readers, with her rights
  E-->>P: conversations · actions · decisions · people · apps · library
```

## Rules

- **A notification informs**; what asks for an action stays in « À faire ». Telling never fails the
  gesture it follows.
- **Who is told**: a request's approvers when it reaches their step (never its requester); a person
  when an app puts a task in her To do, when her scheduled task answered, when her agent raised a
  signal.
- **Her devices are hers**: subscribed from her own space, never while an administrator views it;
  a device the push service forgot is removed.
- **Words** from a catalog (French, English), never hard-coded.
- **Search** goes through the features' own readers — her conversations, her actions, her decision
  inbox, the people of her units, the registry she may see, the library — so it shows exactly what
  the screens show her; every word must match, accents and case aside.

## Requirements

- **FR-001**: `GET /v1/notifications` (list, unread, the push key), `POST /read`, `POST /push`,
  `POST /push/remove`; migration `0028_notifications`.
- **FR-002**: the decisions engine announces who must decide now (`onWaiting`); notifications listen.
- **FR-003**: `GET /v1/search?q=` across conversations, actions, decisions, people, apps, documents.
- **FR-004**: screens « Notifications » (with the device's subscription) and « Rechercher »; a
  service worker (`/sw.js`) shows and opens the pushed notifications.
- **FR-005**: configuration `KETE_VAPID_PUBLIC_KEY`, `KETE_VAPID_PRIVATE_KEY`, `KETE_VAPID_SUBJECT`.

## Proof

Kofi's purchase request reaches Jean-Claude's step: his phone shows « Votre décision est attendue :
Achat de 12 batteries », and a tap opens « À faire ».
