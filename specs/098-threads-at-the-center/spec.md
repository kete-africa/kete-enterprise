# Spec 098 — Threads at the center of the enterprise

The author's go came on 2026-10-21 (« écris la spec complète en corrigeant tout […] utilise au max
ce qui existe pour personnaliser. Écris et implémente, fais tout »), after testing « Fils » on the
local platform. This is the complete spec: the center's screens and links here, the shared
packages in kete-core's spec 139, and what each app adds (section « The apps and the Cockpit »).

## What the author's test showed

1. Signed in with the organization « Kete » active, Kete Enterprise opened an empty organization
   and said nothing: no project, no person, an identifier instead of a name.
2. A name the center does not know shows as `usr_…`.
3. Her own message says « Pas encore lu ».
4. The composer's bottom is cut: « Pour info / Pour action » and « Envoyer » overflow.
5. A group is created alone, and nobody can be added to it.

And the review against Slack, Zulip, Mattermost, Campfire, Twist and Chatwoot: nothing is live,
nothing is unread, no mention, no file, no answer quoted, no search on screen, no notification;
the cards to decide are only in « Pour moi »; a thread is born only when someone outside writes;
an answer to a thread with a mail contact leaves by mail by default; WhatsApp is heard but never
answered; the policy « who speaks for the company » is not asked.

## The shape

```mermaid
flowchart TB
  subgraph objects[the objects]
    P[project] & T[third party] & AP[an app's object · ticket, invoice, contract, leave]
  end
  objects -->|born with it| TH[its thread]
  TH --> L[the list · unread · last activity · search]
  TH --> C[the conversation · live]
  C --> MSG[a message · internal or to the outside · files · quoted answer · @mentions]
  MSG -->|for action| H[a living holding · holder · due · priority · Fait]
  MSG -->|@Kete| K[Kete answers in the thread · drafts as cards]
  MSG -->|Créer…| D[a draft from the message · a ticket, an expense, a request]
  C --> CARDS[the cards of its object · decided here, decided everywhere]
  TH --> S[the state · money · dates · documents · done lately · members]
  MSG -->|to the outside| POL{policy · thread.speak_outside}
  POL -->|allowed| OUT[mail from her box · WhatsApp 24 h, else a template]
  POL -->|approval| AP2[waits for the approver, then leaves]
```

## Requirements

### The frame

- **FR-001 — Which organization.** The frame always names the organization she is in. An
  organization with nothing in Kete Enterprise says so, names her other organizations and lets
  her change: the Compte Kete switches, she comes back signed in to the chosen one.
- **FR-002 — Names, never identifiers.** A person is named from the structure, else from her
  account (the signed-in person's own name), else « Quelqu'un hors de l'organisation »; a contact
  by her third party, else her address.

### The threads screen

- **FR-003 — The list.** By last activity; each thread with its unread count (in bold while
  unread), its last message, ✔ when nothing is waiting in it; « Marquer non lu »; a search across
  the threads she reads, which opens the thread at the message found.
- **FR-004 — Live.** A message, an edit, a read, a member, a file appear without reloading
  (Server-Sent Events fed by `listenThreads`, or by `changesSince` without a direct connection).
- **FR-005 — The composer.** Never cut, on a computer and a phone; « Pour info » or « Pour
  action » (to whom, by when, how urgent); @ to mention a person, an agent or Kete; files added by
  click or drop; « Répondre » quotes a message; when the thread has contacts outside, « Note
  interne » or « Au client » is chosen explicitly — internal by default — and says by which
  channel it leaves.
- **FR-006 — A message.** Its author named, its time, its channel, internal or outside (outside
  marked), its quoted answer, its files (opened, downloaded), its mentions; read by whom (one's own
  messages are read by their author); « Modifier » keeps the original; « Déplacer » to another of
  her threads; « Créer… » a draft from it.
- **FR-007 — A message for action is a living holding.** It shows its holder, its due day, its
  priority, its state, and « Fait » for its holder; the thread shows how many actions are open.
- **FR-008 — Members.** The holder or an administrator adds people (from the structure) and
  agents, and removes them; a group is created with its members.
- **FR-009 — The state beside the thread.** For its object: the money (a project), its dated
  facts (Planifier), its documents (the thread's files and their versions), what was done lately,
  the members since when, the address for replies by mail, the proof — and « Ouvrir la fiche ».

### The links

- **FR-010 — A thread born with its object.** A project and a third party open their thread when
  they are created (and the existing ones get theirs); an app's object (a ticket, an invoice or a
  quote, a contract, a leave) gets its thread when the app says it, through `@kete/center`
  (`openObjectThread`); « Fil » on the object leads to it. With a domain for replies by mail
  (`KETE_THREADS_MAIL_DOMAIN`), an object's thread gets its own address.
- **FR-011 — The cards in the thread.** What waits for a decision on the thread's object — a step
  of a circuit, a request, a draft — appears in the thread as the same card as in « Pour moi »,
  decided there, decided everywhere.
- **FR-012 — Kete in every thread.** « @Kete » asks Kete in the thread: it reads the thread and its
  object's state, answers with the person's capabilities and never more rights than hers, and what
  commits comes as a draft card in the thread.
- **FR-013 — A draft from a message.** « Créer… » hands the message to Kete with what to make (a
  ticket, an expense, a quote, a request, a task — the capabilities she has); the draft comes back
  as a card, each field saying where it came from.
- **FR-014 — Told.** A mention and a message for action to someone tell her (her notifications and
  her devices); who chose it in « Réglages » gets a daily summary of her unread threads by mail.
- **FR-015 — Who speaks for the company.** A message to the outside is the gesture
  `thread.speak_outside`: allowed, it leaves; to approve, it waits as a request for its approvers
  and leaves once approved; refused, she reads which policy refused it.
- **FR-016 — WhatsApp answered.** An outside message to a contact on WhatsApp leaves within 24 hours
  of her last message, else through the template the organization chose in « Réglages », else it
  is refused with the reason.

### The modules around

- **FR-017 — Holdings set by the organization.** Priorities; « Reporter » until a time; a holding
  waiting on another; the delays before a nudge, by priority and for a party, in « Réglages »;
  the fluidity figures declared (`work.open`, `work.overdue`, `work.cycle_days`) for « Mon
  tableau ».
- **FR-018 — Planifier in Outlook.** « S'abonner dans Outlook » gives her secret address of her
  days as iCalendar; she can renew it, which closes the old one.
- **FR-019 — The six policies in forms.** « Politiques » offers the six policies of D-058 as
  sentences with their blanks; before applying one, « Simuler » says which gestures of the last 30
  days it would have decided otherwise.

## The apps and the Cockpit

- **Support** (kete-helpdesk): a ticket's thread is born with it; « Fil » on the ticket.
- **Kete Finance**: a quote's and an invoice's thread born with them; the draft review is
  described by `describeDraft` — labels, F CFA, dates, names — never raw.
- **Kete Commitments**: a contract's thread born with it.
- **Kete Team**: a leave's thread born with it.
- **Kete Cockpit**: an operator whose active organization is not Kete's is offered to change to it
  instead of being refused.

## Proof

- API tests for each requirement above (the center), and in each app for its threads.
- On the local platform (`pnpm platform`), screenshots on a computer and a phone, light and dark:
  the list with unread counts, a live message arriving from another session, a mention, a file
  and its version, an answer quoted, a message for action done, a card decided in the thread,
  « @Kete » answering, a draft from a message, a note internal and an answer to a client by mail,
  a ticket's thread opened from Support, the empty organization's screen, the Cockpit's offer.

## Later

Reactions, sub-threads and presence (no user asked); retention enforced by deletion (a legal
question first); calls in a thread (decision 0012); booking links for clients (Cal.com's kind,
when a client asks); customizable dashboards (their own spec, the author's vision of 2026-10-08).
