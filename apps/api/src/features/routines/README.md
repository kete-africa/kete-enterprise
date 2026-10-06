# Routines (spec 051)

What runs for a person without her, in three families, each with her rights and never more: at a
set time (her scheduled tasks, spec 029), when an app of her team signals (triggers), when a
figure of a dashboard she reads crosses its line (watches). She writes it in a sentence, reads its
plan, activates it; every run is kept.

```mermaid
sequenceDiagram
  participant P as Person
  participant R as /v1/routines
  participant M as Model (structured)
  participant A as An app (its own token)
  participant E as Events (spec 025)
  participant W as Worker
  P->>R: understand « quand un ticket critique arrive, … »
  R->>M: her sentence, the apps she hears, the figures she reads
  M-->>R: family, fields, plan (checked against her choices)
  R-->>P: the plan — nothing kept yet
  P->>R: activate (a schedule, a trigger or a watch)
  A->>E: an event, accepted once
  E->>R: onAppEvent, same transaction
  R->>R: one queued run per active trigger whose person still hears the app
  W->>R: run queued (every minute) — her assistant answers, the answer in « À faire »
  W->>R: check watches due (each at most hourly) — crossing tells her once
```

- **Triggers** name an app of the registry she hears — shown to her, her rights in it giving her
  something — and one of the event types its card declares. A secret event never triggers: its
  data never reaches a model.
- **Watches** name a dashboard she reads, a figure card (a card shown as a number), a direction
  and a line. Crossing the line tells her once (`routine.watch`), and again only after the figure
  came back.
- **Runs** (`routine_runs`): every run, queued, scheduled, watched or tried, with its family, its
  cause, its outcome and a short answer. The scheduled tasks' runs reach the history through
  `onScheduleRun`.
- **Across organizations** the worker learns only identifiers (`routine_runs_queued()`,
  `routine_watches_due()`, security definer), then works each in its organization's transaction.
- **Without a model**, understanding answers `assistant_unavailable`; she fills the same fields
  herself.
