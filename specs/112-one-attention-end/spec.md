# Spec 112 — An agent's signal is a holding; a message's hour is the organization's

Doctrine D-062, R8 (one model of « things in progress ») and R19 (the field's own time zone); the
two items left open by spec 109.

## Requirements

- **FR-001 — A signal is held.** A problem an agent's watch finds and keeps open is a holding in
  « Pour moi »: held by the person the agent acts for, the agent its delegate. Solved or resolved,
  the holding finishes with it.
- **FR-002 — The hour of a message.** A policy that reads the hour of a message to a client (« pas
  après 19 h ») reads it at the organization's time zone, never in UTC.

## Proof

`tests/agents.test.ts`: the signal raised is held by Awa with her agent as delegate, and leaves
« Pour moi » once solved. `tests/policies.test.ts`: in an organization working in Tokyo, a message at
10:30 UTC (19:30 there) is refused, one at 05:00 UTC is not.
