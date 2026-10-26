# Spec 108 — An agent acts while its person is away

Doctrine D-062 (R5) and kete-core ADR 0018: an agent receives the apps' tools through federation,
with its person's mandate. Its tasks run in the worker, where no token of hers is at hand: an agent
reached none of the team's apps, whatever its job description said. Kete-core spec 150 gives the
standing mandate; this spec is the center's side.

## Requirements

- **FR-001 — Given by her.** Beside its thread, « En votre absence »: the person the agent acts for,
  signed in, lets it act for her while she is away. Her token goes to the Compte Kete as her
  consent; the grant it answers is kept on the agent. She, or a manager of agents, takes it back —
  here and at the Compte Kete.
- **FR-002 — The apps of its sources.** An agent's job description names the team's apps by their
  product among its sources; the panel offers them beside Kete's own sets.
- **FR-003 — Reached with the mandate of now.** A task whose agent names apps asks the Compte Kete
  for its mandate of now and receives those apps' tools only; each app applies its own rights and
  autonomy. Without a grant, withdrawn, or refused, no app is reached.

## Proof

`apps/api/tests/agents-away.test.ts`: Kofi cannot give Awa's agent its mandate; Awa can, with her
token; its side shows the team's app and since when; a task then reaches the app with the mandate
of now, and its step is recorded; an app its sources do not name is not reached; withdrawn, here
and at the Compte Kete, no app is reached; with mandates off, it cannot be given.

## Left for later

- ~~Routines (`features/routines`) that call apps run without a mandate too; they move onto agents
  (doctrine R13) rather than gaining their own.~~ Done in spec 113.
