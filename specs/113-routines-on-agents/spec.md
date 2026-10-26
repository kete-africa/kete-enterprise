# Spec 113 — A routine hands its work to an agent

Doctrine D-062 (R5, R13) and spec 108: an agent reaches the team's apps with the mandate its person
gave it. A routine of hers (a trigger on an app's event, a scheduled task) ran her assistant, which
reached no app while she was away. The routine does not gain a mandate of its own: it hands its
work to one of her agents.

## Requirements

- **FR-001 — An agent on a routine.** A trigger and a scheduled task (kind « question ») may name
  one agent of hers. She chooses among the agents she has; one she does not have is refused.
- **FR-002 — The work is the agent's.** When the routine runs — an event heard, the time come, or
  « Essayer maintenant » — it gives the agent a task as she would have given it: her instruction,
  and for a trigger the event's facts (secret data never). The task's requests expire after ten
  minutes, as for the agent's own routine (spec 099, FR-015). The agent answers in its thread with
  her; with her standing mandate it reaches the apps its sources name.
- **FR-003 — The run says so.** The run in her history reads « Confié à <agent> » and opens the
  agent's thread. A scheduled task handed to an agent sends no e-mail: the answer is in the thread.
- **FR-004 — No agent, no change.** A routine without an agent runs as before.
- **FR-005 — An agent gone.** If the agent is no longer at work or no longer hers, the run fails
  and says so; it never falls back to the assistant.

## Proof

`apps/api/tests/routines-on-agents.test.ts`: a trigger and a schedule naming Awa's agent give it a
task with her instruction and the event's facts, a mandate-carrying task reaches the app; Kofi
cannot name Awa's agent; a paused agent makes the run fail; a routine without agent still answers
through the assistant.
