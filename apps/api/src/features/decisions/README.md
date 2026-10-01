# Decisions (spec 005)

One engine for every request that needs a person's approval (doctrine D-028): a **circuit**,
written as data, lists the steps of a **subject** (« promotion of a resource », later an expense or
a leave). Each step names its approver by relation or by role, and may apply from a threshold.

```mermaid
sequenceDiagram
  participant F as A feature (registry)
  participant E as Decisions
  participant I as Inbox
  F->>E: openRequest(subject, reference, measure) — in the feature's transaction
  E->>E: active circuit? copy its steps; under its threshold, a step is skipped
  I->>E: who decides now? (the structure and the rights, today)
  E-->>I: the current step's approvers, never the requester
  I->>E: decide-request (approve)
  alt another step applies
    E->>E: the next step waits
  else last step, or a refusal
    E->>F: the subject's handler carries the outcome out, same transaction
  end
```

- **Approver rules**: `manager` (the position the requester's primary position reports to),
  `role` (the holders of a role whose grant covers the request's unit: everywhere, a unit above it,
  or its country), `position` (its holders), `person`.
- **Found when someone looks**, from today's assignments: whoever holds the position by interim or
  delegation decides; when a holder changes, the Inbox follows.
- **Never the requester.** A step that finds nobody else goes to the organization's
  administrators. Only a person decides: an agent never does (principle 3, D-039).
- **Thresholds**: a step applies from a measure (an amount, a risk level); under it, it is skipped.
  A request whose every step is skipped is approved at once.
- **Overdue**: a step waiting longer than its circuit's `remindAfterHours` is flagged in the Inbox;
  sending reminders comes with the worker (spec 007).
- **Subjects** are declared by the features (`registerSubject`); a circuit exists for a known
  subject only, and a new one replaces the active one for new requests.

## In the registry

With a circuit for `registry.promotion`, a promotion opens a request whose measure is the resource's
risk (low 1, medium or unknown 2, high 3), so a step can apply to high risk only; the registry's
direct review no longer applies to it (`in_circuit`). Without a circuit, the registry reviews
directly (spec 004).

## Routes

| Route                                           | What                                               |
| ----------------------------------------------- | -------------------------------------------------- |
| `GET /v1/decisions/inbox`                       | What waits for the person, and her own requests    |
| `POST /v1/decisions/requests/:requestId/decide` | `decide-request`: approve or refuse, with a reason |
| `GET /v1/decisions/circuits`                    | The active circuits and known subjects             |
| `POST /v1/decisions/circuits`                   | `define-circuit` (« decisions:manage »)            |
