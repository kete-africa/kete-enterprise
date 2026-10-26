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

## Handed to an agent (spec 113)

A trigger and a scheduled question may name one agent of hers. The routine then gives no answer of
its own: it gives the agent a task as she would have, and the agent works with the mandate she gave
it for her absence (spec 108), reaching the apps its sources name.

```mermaid
sequenceDiagram
  participant W as Worker
  participant R as Routine (trigger or schedule)
  participant G as Agent hand-off
  participant T as Agent task
  participant A as An app
  W->>R: run (event heard, time come, or « Essayer maintenant »)
  R->>G: her instruction + the event's facts (never secret data)
  G->>G: the agent is at work and hers? otherwise the run fails
  G->>T: queued task, requests expire after ten minutes
  G-->>R: « Confié à <agent> », links to its thread
  T->>A: its tools, with her mandate of now
  T-->>G: its answer, in its thread with her
```

- No agent, no change: the assistant answers as before. An agent gone never falls back to the
  assistant — the run fails and says so.
- A scheduled task handed to an agent sends no e-mail; the answer is in the agent's thread.
- Kept in `agent_id` on `routine_triggers` and `assistant_schedules` (migration 0087). The
  assistant feature cannot import the agents above it: `useAgentHandOff` is how the routines
  feature lends it the hand-off.
