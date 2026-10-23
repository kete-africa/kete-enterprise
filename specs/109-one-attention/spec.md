# Spec 109 — One attention model

Doctrine D-062, R14; kete-core spec 151 gives `attend` in `@kete/notify`. The audit found six places
in Kete Enterprise deciding alone who is told: the notifications, the threads' push, the evening
digest, the phone, the relay's nudges, the agents' signals; her quiet hours were read by none, and
the digest left at 18 h UTC whatever her hour.

## Requirements

- **FR-001 — One door.** Every path tells through `tell`, which weighs the signal (to act, to know,
  urgent) and lets `attend` decide: once by its key, her list always, her devices at once or after
  her quiet hours.
- **FR-002 — Her choices, kept.** Opening « Pour moi » keeps her quiet hours, time zone, channels
  and summary on her person, for the worker.
- **FR-003 — Keys where the event has one.** A decision's step, a holding moved to someone, a
  holding stuck or nudged once a day, an agent's signal.
- **FR-004 — The phone and the threads.** A decision waiting reaches her tied phone at once or
  after her quiet hours; a thread never rings in them.
- **FR-005 — Her summary at her hour.** After 18 h in her time zone, or her organization's; once a
  day at her own date.

## Proof

`apps/api/tests/attention.test.ts`: told once by its key and rung outside her quiet hours; held in
them and rung once they end; urgent rings in them; what she needs to know never rings; a thread
does not ring in them; her summary leaves at 19 h in Tokyo, not at 10 h in Lomé, once.

## Left for later

- Agents' signals become holdings (« Pour moi ») rather than notifications (D-062, R8).
- The policies' « hour of a message » at the organization's time zone (`policies.ts`).
