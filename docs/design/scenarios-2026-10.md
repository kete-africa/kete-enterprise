# Twelve scenarios, and the gaps they show (2026-10-13)

Step **C11** of the plan (`docs/ROADMAP.md`). Twelve things a person does in a working day, played
in Kete Enterprise, each scored, with what is missing.

**How far this goes — read this first.**

- **Kete Enterprise was played** on this day with `pnpm demo`: the KYA demo organization on a
  throwaway schema, as its administrator and as Abla Nyuiadzi, head of after-sales.
- **The demo has no model and no ERP.** The assistant's answers, the agent's proposal and the ERP
  are written in advance (`apps/api/db/demo/`). So a scenario proves that the screens and the
  rules work — never the quality of an answer. No scenario can reach the top score here.
- **ChatGPT and Claude were not played.** This was done without an account on either product, and
  a scripted demo cannot be compared with them on the quality of answers. Their columns are left
  empty, with what to look at, for a person to play. Nothing below says what they can or cannot do.

## The score

| Score | Meaning                                                                                |
| ----- | -------------------------------------------------------------------------------------- |
| 0     | Not possible                                                                           |
| 1     | Possible in part, or proven by tests only: not seen end to end in the demo             |
| 2     | Seen end to end in the demo, on answers and data written in advance                    |
| 3     | Seen end to end with a real model and the organization's real data — out of reach here |

## The twelve scenarios

| #   | Scenario                                                               | Kete Enterprise | ChatGPT | Claude  |
| --- | ---------------------------------------------------------------------- | --------------- | ------- | ------- |
| 1   | Her morning: what waits for her, and she decides                       | 2               | to play | to play |
| 2   | A question on the team's figures, answered by a table she acts on      | 2               | to play | to play |
| 3   | A question answered from a document, the passage cited                 | 2               | to play | to play |
| 4   | Work asked of a colleague, returned signed                             | 2               | to play | to play |
| 5   | A task given to an agent, steered while it works                       | 2               | to play | to play |
| 6   | An agent from a sentence, tried before it runs                         | 2               | to play | to play |
| 7   | An agent prepares what commits; she decides; « Comment ? »             | 1               | to play | to play |
| 8   | A rule of the organization refuses an agent, and the evidence shows it | 1               | to play | to play |
| 9   | A purchase request made in the ERP lands where she decides             | 2               | to play | to play |
| 10  | Reached and answering on WhatsApp or Telegram                          | 0               | to play | to play |
| 11  | In the field: a report dictated on a phone                             | 1               | to play | to play |
| 12  | What it remembers of her, read and erased; her data taken out          | 1               | to play | to play |
|     | **Total**                                                              | **18 / 36**     |         |         |

## Scenario by scenario

### 1. Her morning: what waits for her, and she decides — 2

- **Played**: as Abla, « Aujourd'hui » lists two decisions (« Suivi des batteries », « Relances des
  impayés »), a reminder, and Folly Ayité's request; « Pendant ce temps » shows her agent's task
  in line; « Fait pour vous depuis hier » shows two tasks done, each with « Comment ? ».
- **Gaps**
  - A task's origin is shown by its internal name: « Dans notes », « Dans requests ».
  - A decision's analysis for its reader needs a model: not seen today.
  - The purchase requests of the ERP (scenario 9) arrive in « À faire », not grouped with the
    decisions of the organization's own circuits.
- **To look at elsewhere**: does it know what waits for her across her tools without being asked?

### 2. A question on the team's figures, answered by a table she acts on — 2

- **Played** (spec 063): any question returns the unpaid invoices as a table read by the
  assistant's own tool; she sorts, filters, selects rows and « Agir » on them; a second message
  waits « En file ».
- **Gaps**
  - The answer is written in advance: nothing is proven about a real model choosing the right
    dataset and filter.
  - No chart beside the table; the table cannot be kept as a view of « Décider ».
- **To look at elsewhere**: are the figures computed by code or written by the model? Can she act
  on rows?

### 3. A question answered from a document, the passage cited — 2

- **Played** (spec 064): the library holds one after-sales report; a cited passage opens the
  document at its place, marked; « Fichiers du fil » lists the thread's pieces.
- **Gaps**
  - The demo indexes with a hashed embedder, not a real one: retrieval quality is unproven.
  - One document: nothing is proven on a real library, nor on rights over documents at scale.
- **To look at elsewhere**: does the citation open the exact passage, and only what she may read?

### 4. Work asked of a colleague, returned signed — 2

- **Played** (spec 065): Folly Ayité asks Abla for a quote; she hands it to her Agent SAV, reads
  what it prepared, and returns it: « Préparé par Agent SAV, relu et signé par Abla Nyuiadzi ».
- **Gaps**
  - The colleague is typed by name: no picker. She can ask only someone the directory shows her
    — her managers and her reports, unless she reads the structure.
  - No project, no thread with several people, no request answered from a phone's messaging.
  - Nobody takes over an absent person's requests but the colleague she named herself (spec 067).
- **To look at elsewhere**: does who asks see a state only, and does the return say who validated?

### 5. A task given to an agent, steered while it works — 2

- **Played** (spec 066): Abla pauses her agent's task — « En pause — Mis en pause par Abla
  Nyuiadzi » — and takes it over: « Reprise en main », and the work is in her « À faire ».
- **Gaps**
  - Seen on a task not yet started. A running task interrupted at its next step is proven by tests
    with a scripted model, never with a real one.
  - The page does not refresh by itself: a step appears when she reloads.
  - Its plan and its budget (time, share of the model's ceiling) are not shown.
- **To look at elsewhere**: can she stop, redirect and take over without losing what was done?

### 6. An agent from a sentence, tried before it runs — 2

- **Played** (spec 067): a sentence proposes « Veille de mes décisions »; « Essai à blanc —
  Aujourd'hui, il n'aurait rien eu à vous signaler »; « Créer cet agent » creates it and runs its
  first round.
- **Gaps**
  - The dry run reads today, not last week.
  - The proposal is written in advance: a real model understanding a sentence is unproven.
  - An agent watches three things only (registry, decisions, compliance).
- **To look at elsewhere**: does it say what the agent will and will not do, and try it first?

### 7. An agent prepares what commits; she decides; « Comment ? » — 1

- **Played**: « Comment ? » is offered on each task done. **Not seen in the demo**: its agents call
  no capability, so no draft waits and no step is listed.
- **Proven by tests** (specs 036, 056): a commitment is a draft she validates or refuses; each
  step is recorded with its right and its level.
- **Gaps**
  - The demo shows no draft prepared by an agent: the heart of the trust layer is not on screen.
- **To look at elsewhere**: can an agent commit anything without a person? Is every step shown?

### 8. A rule of the organization refuses an agent, and the evidence shows it — 1

- **Played** (spec 068): the administrator tries « Aucun agent n'agit seul » on the last month and
  switches it on. **Not seen in the demo**: a refusal — its agents call no capability.
- **Proven by tests**: the gesture is refused, the journal names the rule, the agent, for whom.
- **Gaps**
  - Two of the eight families are applied (tools, autonomy). Data, models, retention,
    transparency, budgets and exit are not written as rules.
  - A rule cannot be narrowed to a unit.
- **To look at elsewhere**: can an administrator forbid something to every agent, and prove it held?

### 9. A purchase request made in the ERP lands where she decides — 2

- **Played** (spec 069): the administrator tries the connector — « 3 en attente dans l'outil : 2
  pour une personne connue, 1 sans personne connue » — connects it and reads it; Abla's « À faire »
  shows the two purchase requests, each opening the ERP's page.
- **Gaps**
  - **No real Frappe was reached**: the ERP is written in advance.
  - She cannot approve from the center: the connector only reads.
  - A server reached over stdio cannot be connected: an https address is needed.
- **To look at elsewhere**: does what waits in the company's own tools come to her, in her rights?

### 10. Reached and answering on WhatsApp or Telegram — 0

- **Not possible**: Kete Enterprise sends nothing to WhatsApp nor Telegram, and hears nothing
  from them. The chat outbox exists in `kete-core` (`@kete/notify`, spec 088) and is not used here.
- **Gaps**
  - A decision, a request or an agent's question cannot reach her phone's messaging.
  - She cannot answer from there.
- **To look at elsewhere**: can she work from the messaging app she already uses all day?

### 11. In the field: a report dictated on a phone — 1

- **Played**: the phone's layout and its tabs (Décider, Demander, Déléguer, Tout). **Not played**:
  dictation needs a transcription model, and the demo has none.
- **Proven by tests** (spec 059): a dictated note is filed with what it reports on.
- **Gaps**
  - Dictating a note, and dictating to the assistant (« Dicter », in the composer), need a
    transcription model: neither was played.
  - Nothing works offline.
- **To look at elsewhere**: does it work with one hand, a poor network, and French spoken in Lomé?

### 12. What it remembers of her, read and erased; her data taken out — 1

- **Not replayed today**. The assistant's memories are listed and forgotten one by one
  (`/v1/assistant/memory`).
- **Gaps**
  - No route exports what the organization holds: its data cannot be taken out in one gesture.
  - No route erases a conversation with the assistant: she reads them, she cannot delete them.
    Erasing a person's conversations and memory at once exists in `kete-core` (`@kete/agents`,
    spec 090) and is not used here.
- **To look at elsewhere**: can she read, correct and erase what it keeps? Can the organization
  leave with everything?

## The gaps, in the order they hurt

1. **Nothing was played with a real model.** Seven scenarios stop at 2 for this reason alone.
2. **WhatsApp and Telegram** (scenario 10): the only scenario at 0.
3. **The demo shows no draft and no refusal** (scenarios 7 and 8): the trust layer is proven by
   tests and invisible on screen.
4. **A real ERP** (scenario 9), and approving from the center.
5. **Export and erasure** (scenario 12).
6. **Dictation and offline** (scenario 11).
7. Smaller ones: internal names shown for a task's origin; no live refresh of an agent's run; the
   dry run reads today only; a colleague typed by name.

These are observations. What to do about them, and in what order, is the author's to decide.

## To play in ChatGPT and in Claude

For each scenario, the same person plays the same thing with the same material — the KYA demo's
unpaid invoices, its after-sales report, a purchase request — and scores it on the scale above.
Note for each: whether it was possible at all; what had to be set up first and by whom; what a
person had to check by hand; and whether an administrator could prove afterwards what was done.
