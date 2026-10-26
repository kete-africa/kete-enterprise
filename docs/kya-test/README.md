# The KYA test — one day, as KYA lives it

Doctrine D-062 (R10, « done ») and the audit of kete-core (`docs/audit/d062-audit.md` § 6): Kete is
tested on KYA-Energy Group. This page is what the test is made of: the day to live, how it is
checked before KYA touches it, and what still blocks it. The older `docs/demo-kya/` is the October
presentation to the general management; this one is the test.

Perimeter proposed (not yet confirmed by KYA): the **SAV & Maintenance** service and the **Codir**.
Everything runs on staging with fictitious e-mails until the author says otherwise.

## The day to live

Persons of the demo (KYA profile): **Abla Nyuiadzi** (head of SAV & Maintenance), **Folly Ayité**
(her manager), **Délali Tchalla** (technician), **Komlan Adjévi** (DG), the administrator of the
demonstration. In the demo, `pnpm demo --fresh` prints « Le matin de Abla Nyuiadzi » and a link
for each person.

| Hour  | Screen                           | What she does                                                                                                                     | What must be true                                                                                                                                     |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7:45  | `/` « Pour moi »                 | Reads what needs her, most pressing first; decides « Suivi des batteries » (Décider), answers Folly's request, snoozes the rest   | Two decisions, a note, a colleague's request and a client's WhatsApp are there, each said in words (never a key or an id); « Clore ma journée » opens |
| 8:00  | `/fils` « Chantier Garage Bè »   | Reads the client's WhatsApp message, Délali's answer; answers with the one composer; attaches a photo; cites a holding with « # » | The client's channel is said; her reply goes out on the same channel; the object's state sits beside the thread                                       |
| 8:15  | `/assistant` « Kete »            | Says a word from a client visit (case A, « Je sors de chez… »), then a rule and an order (case B, « … passe par moi. @Délali … ») | Nothing exists before her « oui »; Kete carries no « agent » tag; a group's orders are answered to their author alone                                 |
| 8:30  | `/mes-agents`                    | Sees Agent SAV and Agent Achats by state, gives Agent SAV work by talking, answers its request « Autoriser une fois / Toujours… » | Its answer comes with its steps; « Toujours » never applies to signing or paying; its request expires after ten minutes when its routine asked        |
| 8:45  | `/routines`                      | Writes « Chaque matin, dis-moi ce qui reste ouvert », hands it to Agent SAV (« Confier à »), « Essayer maintenant »               | The run says « Confié à Agent SAV » and opens its thread; a routine on an app's event is one run once, however often the dispatcher runs              |
| 9:00  | `/planifier`                     | Reads the week (her appointments, apps' deadlines, leaves, agents' passes), sees the conflict, subscribes in Outlook              | The conflict is shown, never decided for her                                                                                                          |
| 9:30  | `/equipements` « Mini-centrale » | Opens the asset in alert: its thread, its history (« Son histoire »), its holdings                                                | An object reaching an alert state tells its thread and wakes the agents that follow it, once                                                          |
| 10:00 | `/pilotage`                      | Reads « Taux de disponibilité du parc sous contrat » (50 %, rouge), « D'où vient ce chiffre ? »                                   | Red opens one corrective holding for the owner; a missing figure is red, never zero                                                                   |
| 11:00 | `/reglages`                      | Sets her quiet hours and her evening summary                                                                                      | Urgent rings at any hour, what is to act on waits for the morning, what is to know never rings                                                        |

The administrator's side, five minutes (`/administration`): « Mails et conversations » (boxes, the
routing steps' counts, imports), « Connexions », the agents' catalogue, « Politiques », rights.

## Checked before KYA — the walk of 2026-10-26

Run in the demo, as Abla and as the administrator, through the browser pane:

- Every screen of the day answers, as Abla and as the administrator (about sixty pages fetched):
  no error page, no server error in the demo's log — but the two direct addresses below.
- « Fait pour vous depuis hier »: Agent SAV's three tasks, with « Comment ? ».
- A routine handed to an agent, from the sentence to its run in the history.
- « Mails et conversations »: the empty state and the form, the five routing steps and one mail
  « à classer ».

Fixed on the way: Kete's morning point carried the « agent » tag (its author is the briefing, not
the assistant): drawn as Kete now (`threads-view.tsx`).

## What stays to say to the testers

- The demo's Kete is written in advance: any question answers with the unpaid invoices' table. It
  proves the screens, never the quality of an answer; the test on staging runs on the real model.
- A direct address to a page one has no right to (`/tiers` for Abla) shows « Cette page n'a pas pu
  s'afficher » instead of « Vous n'avez pas accès » — the sidebar never offers it. Same for an
  unknown object (`/lieux/<unknown>`).
- « Pour info » repeats what « Pour moi » already holds (the two decisions, Folly's request) and
  says three times that Agent SAV finished a task.

## What still blocks — and who unblocks it

### Waits on the author

1. **The domain of the threads' addresses** (`KETE_THREAD_DOMAIN`, e.g. `fils.<domain>.tg`): without
   it, no thread has an address and a mail in copy does not enter by itself (step 2 of the routing).
2. **The model's key** on staging (`gpt-6.1-sol`, set in Coolify): without it, Kete and the
   agents answer nothing.
3. **Mandates on at staging**: `pnpm clients grant --client <Enterprise> --mandate` at the Compte
   Kete and `KETE_MANDATES=on` on the API. Without them an agent « en votre absence » reaches no
   app, and a routine handed to an agent only gives it a task it can answer from Kete's own tools.
4. **The test perimeter and the people**: SAV & Maintenance + Codir, the ~55 accounts at the Compte
   Kete (or the dozen of the perimeter), who is the administrator.

### Waits on KYA (data and access)

5. **Mailboxes** (IMAP at O2switch): one shared box, then the personal ones, each entered by an
   administrator and sealed. Nothing is read before.
6. **WhatsApp Business** number(s) and **Telegram** bot: today « non relié »; without them clients
   reach Kete only by the site's form.
7. **The park**: the 487 installations (66 % without locality, unit errors) are not loaded; the demo
   has four assets. The data-quality agent has nothing to work on until a first cleaned extract is
   given.
8. **The indicators' sources**: ERP/Frappe, KYA-SolMonitor, registers — several do not exist. The
   referential (KYA-KPI-01) is seeded; its readings are the demo's until a source is connected.
   Open questions: which Frappe modules are live and their API; SolMonitor's API and coverage;
   Zoom cloud recording and transcript.

### Waits on operations

9. **Staging at the latest `dev`**: Enterprise, the Compte Kete, kete-helpdesk and the packages of the
   release 152; migrations 0071 to 0088 applied; the storage port (S3 or disk) set for files and
   voice notes; the worker running (dispatcher, agents' tasks, routines, digests).
10. **Mail out**: `KETE_MAIL_MODE` decided (capture while fictitious, real for the test).

### Known and accepted for the test

- Not built: meeting and story modes of the boards, cross-filter and drag; trends from freezes;
  one table for every credential; spend metered per connection; budgets per unit and per person;
  retention and export by kind of object; phone calls with an agent; billing; the Cockpit's
  « Flotte » pushing a version and restoring a backup on screen. None is on KYA's day.
- The second pass of the audit, module by module, comes after the first real day (R10).

## Going on

1. The author settles points 1 to 4 (a morning's work).
2. A first pass on staging as the administrator: points 9 and 10, then the demo organization's day
   on the real model.
3. KYA gives 5 to 8 by order of value: mailboxes and WhatsApp first, the cleaned extract of the
   park second, the indicators' sources third.
4. The day above is lived by two or three persons of SAV & Maintenance; what they trip on is
   written the same evening in the audit's § 6.
