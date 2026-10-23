# Spec 107 — Actors, an object's life, the organization's hour

Doctrine D-062: one actor model drawn alike everywhere (R6); an object's life — what happens to its
thread when it closes (R12); the field — the organization's own time zone, not Lomé's by default
in code (R19). Kete-core spec 149 gives `actor.v1`, `ActorAvatar` and the threads' `faceOf`.

## Requirements

- **FR-001 — An object's life.** When an object reaches a state its kind calls closed — a project
  closed, a ticket solved, an asset retired — its thread is put away with it (kept, readable,
  nothing more said in it); opened again, its thread opens. A thread merged into another stays
  where it went. A consumer of the one event path (spec 101), acting once.
- **FR-002 — An agent's face.** Taken from a template, an agent keeps its face (`agents.face`); its
  threads send the faces of the agents they show, and the conversation draws them; without one, a
  face drawn from its id — the same everywhere.
- **FR-003 — The organization's hour.** An agent's routine and Kete's scheduled tasks run at the
  organization's time zone (`kete.time_zone`), no longer Lomé's written in the code.

## Proof

`tests/actors-life.test.ts`: an asset retired puts its thread away, nothing more said in it, and
back in service its thread opens again; « Agent Parc » taken from the catalogue keeps its face,
sent with its thread; the hour of a moment in Lomé, Lagos and Nairobi.

## Left for later

- One attention consumer deciding who is told, of what, on which channel, once (R14): today six
  paths (notifications, push, phone, digest, relay nudges, briefing) each decide for themselves.
- Retention and export of a closed object's thread and files, by kind (R12; the durations are a
  matter of law and the author's).
- The evening digest and the policies' « hour of a message » at the organization's time zone.
