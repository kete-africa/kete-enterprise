# Spec 114 — Routines and watches on the one event path

Doctrine D-062 (R11), kete-core ADR 0017, left open by spec 101: the routines an app's event
triggers, and the figure watches, still had their own trigger. They become consumers of the one path.

## Requirements

- **FR-001 — A trigger is a consumer.** An app's business event in the log (never a secret one) is
  delivered by the dispatcher to each active trigger listening to it, once: the run is queued in the
  delivery's own transaction (`routine:<trigger>`). A replay queues nothing more; a failure is kept,
  retried five times, then shown to the administrator, like any consumer. The app no longer calls
  the routines itself.
- **FR-002 — Her rights still decide.** The run is queued only if its person still hears the app and
  the app still declares the type, as before.
- **FR-003 — A figure crossing is an event.** When a watch tells its person that a figure crossed its
  line, the center records `figure.crossed` in the log (product `center`; data: the dashboard, the
  card, the direction, the line, the value). Whoever follows `figure.*` — an agent, as any
  subscription — learns it through the dispatcher.
- **FR-004 — The agent's task says what happened.** For an event the center recorded, the task's
  words use its label, not its type.

## Proof

`tests/routines.test.ts` (an event queues one run per trigger once the dispatcher has run, never
twice, never on a secret event); `tests/routines-on-agents.test.ts`; `tests/events.test.ts` (a
watch crossing is recorded, and an agent following `figure.*` gets one task).
