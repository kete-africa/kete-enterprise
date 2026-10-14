# Spec 083 — The evening's closure

Step **C2** of the plan, continued (`docs/ROADMAP.md`; doctrine D-051; kete-core spec 104): Décider
ends the day — she writes or says what her day was, and the assistant proposes gestures on her To
do, which she ticks, applies together, and may undo together.

## Why

The method (D-051) closes the day with one sentence or one voice note. Without it, the evening is a
list of screens: close this, move that, set a reminder. An assistant may propose; she decides, and
she must be able to take it all back. A gesture on a task she does not have is worse than none.

```mermaid
sequenceDiagram
  participant P as Awa
  participant W as « Ce soir » (/soir)
  participant A as /v1/closure
  participant U as understand (@kete/ai)
  P->>W: « J'ai fini la relance Garage Bè ; le rapport attendra lundi ; rappelle-moi Ecobank jeudi »
  W->>A: POST /v1/closure
  A->>U: her note, today, her open To do, the three gestures offered
  U-->>A: close the relance, move the report to Monday, a reminder Thursday
  A-->>W: a proposal set — ticked up to level 2
  P->>W: « Appliquer (3) »
  W->>A: POST /:id/apply — her To do changes
  P->>W: « Tout annuler »
  W->>A: POST /:id/undo — her To do as it was
```

## What it gives

- **« Ce soir »** (`/soir`), from Décider (« Clore ma journée »): her note, or her voice through the
  dictation she already has (spec 059); the gestures proposed; « Appliquer », « Ne rien garder »,
  « Tout annuler »; what she wrote that named nothing, said back.
- **Three gestures**, all reversible: close a task of her To do, move it to a day, a reminder on a
  day — never on what she does not have, never without its day.
- **Proposal sets** of `@kete/drafts` (migration `0062_proposal_sets`, RLS in it): applied together,
  undone together, frozen once dismissed or undone; another person's set is not hers.

## Proof

- `apps/api/tests/closure.test.ts` (2, against Postgres): without a model, `assistant_unavailable`;
  three gestures on her To do — a move without its day left out — Kofi cannot apply her set; applied,
  her To do changes (a task closed, one moved to Monday 9 h, a reminder Thursday 9 h); undone, it is
  as it was.
- In the demo (`pnpm demo --fresh`, as Abla Nyuiadzi): « Clore ma journée » on Décider, a note, three
  gestures proposed on her own To do, applied — « fait » ×3 — then undone — « annulé » ×3. The demo's
  model is written in advance (`scriptedEvening`).

## What stays for later

The evening closed from WhatsApp or Telegram — a voice note heard (`wordsOf` of `@kete/notify`) and
answered with its proposals; the week's review; the morning's pile on the phone (`MorningPile`).
