# Spec 029 — Scheduled tasks and the morning briefing (the assistant's memory follows)

## Why

An assistant of this era does not only answer: it comes back at the time a person set. « Every
Monday at 8, the late actions of my team », « my briefing at 7:30 on weekdays, by e-mail » — asked
once, in the chat or on a page, then done on time, with her rights, never more.

## The flow

```mermaid
sequenceDiagram
  participant P as Person
  participant E as Kete Enterprise
  participant W as Worker (every 5 minutes)
  participant M as Model
  P->>E: « chaque lundi à 8 h, les actions en retard de mon équipe » (chat tool) or Mes tâches planifiées
  E->>E: keep it (her name, e-mail, language, time zone); its next time computed
  W->>E: schedules due (assistant_schedules_due)
  W->>E: take one — its next time set first, never run twice
  alt her morning briefing
    W->>M: her facts, read with her rights
    M-->>W: five to eight lines
    W->>E: the briefing of the day, on her home page
  else a question
    W->>M: her question, her tools (asPerson, never an administrator)
    M-->>W: the answer
    W->>E: a conversation of hers; a task in « À faire » that opens it
  end
  W->>E: an e-mail if she asked (mail queue, capture mode in tests)
```

## Rules

- **Hers only**: a person sees, pauses, resumes, runs at once or removes her own tasks; an
  administrator viewing her space never changes them. Twenty at most.
- **Her rights, never more**: the worker acts as her agent (`agt_assistant`, channel `worker`),
  with the role of nobody — the rights the structure gives her, as agents do (D-039).
- **Never twice**: a task is taken by setting its next time first; a paused task resumed runs at
  its next time, never to catch up.
- **Who pays**: her own key when she brought one and the policy allows it, else the organization
  (spec 026); journaled `schedule` or `schedule:personal`. Without any model, a briefing is written
  by the rules; a question waits (`no_model`).
- **Where it lands**: the briefing on her home page; a question's answer as a conversation, and a
  task in « À faire » that opens it (one per task and day); by e-mail when she asked
  (`assistant.briefing`, `assistant.schedule`).
- **Time**: a time of day in her time zone (the browser's, `Africa/Lome` by default), every day,
  on weekdays, or one day a week.

## Requirements

- **FR-001**: `GET /v1/assistant/schedules`, `POST /v1/assistant/schedules`,
  `POST /v1/assistant/schedules/:id/active`, `/run`, `/remove`.
- **FR-002**: the chat's tool `schedule_task` (level 2) keeps a task of hers from a sentence.
- **FR-003**: the worker's job `run-schedules`, every five minutes.
- **FR-004**: table `assistant_schedules` with its row-level security, and the function
  `assistant_schedules_due()`, in migration `0024_assistant_schedules`.
- **FR-005**: the page « Mes tâches planifiées » (`/assistant/taches`), linked from the assistant.

## Next

The assistant's memory — what she asks it to remember, shown and erasable by her — completes this
spec.

## Proof

« Every Monday at 8 » runs: the answer lands in Kofi's « À faire » and in his mailbox.
