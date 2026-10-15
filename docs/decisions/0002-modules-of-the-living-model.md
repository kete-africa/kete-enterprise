---
status: accepted
date: 2026-10-15
---

# The center's features gathered into the living model's modules

## Context and Problem Statement

Kete Enterprise's API has 43 feature folders side by side, named after the specs that created
them. Each is clean and tested; together they have no shape. Six of them say « a thing in
progress » (requests, to do, meeting actions, circuit steps, drafts, agent tasks), five say « we
talk » (the assistant, exchanges between assistants, phone, notifications, mail), two answer « who
may do what » (decisions' circuits for people, rules for agents). Doctrine D-056 to D-058 decide one
living model; kete-core decision 0011 places its primitives. How does the center follow?

## Decision Drivers

- D-056: holdings, threads, gestures and policies replace the parallel models; nothing is rewritten
  at once.
- D-058: one policy engine at the gesture, for a person and an agent.
- Decision 0001: the API owns the data; the screens stay thin.
- kete-core primitives (`@kete/work`, `@kete/policies`, `@kete/threads`) are consumed, never
  re-implemented.

## Considered Options

- Keep the folders as they are; only add the new modules.
- Rename and move every folder at once into module folders.
- Gather the features into modules as each module is built, one source at a time.

## Decision Outcome

Chosen option: "Gather as each module is built", because a big move breaks working features for no
reader's gain, while each unification step already touches the features it absorbs.

The modules, and what each absorbs:

| Module        | Features it gathers                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `references`  | `structure`, `directory`, `parties`, `projects`, `organization`; later places, assets, the catalogue, the group                        |
| `governance`  | `rights` (who holds what) beside one policy engine absorbing `decisions`' circuits and `rules`; `registry`, `compliance`, `governance` |
| `work`        | holdings from `requests`, `todo`, `actions`, circuit steps, drafts awaiting a person, agent tasks; the relay; « Pour moi »             |
| `messages`    | threads and channels from `assistant`, `exchanges`, `phone`, `notifications`, `mail`; `meetings` become threads with several people    |
| `knowledge`   | `knowledge`, `documents`, `dossiers`, `skills`, `notes` and the memory                                                                 |
| `time-boards` | `time`, `dashboards`, `routines`, `datasets`, `forms`, `surveys`, `performance`, `money`                                               |
| `agents`      | `agents`, `gateway`, `connectors`, `apps`, `app-requests`                                                                              |
| `platform`    | `workspace`, `search`, `passes`, `ai`                                                                                                  |

`closure` (the evening) becomes a use of notes, holdings and gestures; it keeps no model of its own.

### Consequences

- Good, because « who holds what », « where do we talk » and « may this be done » each get one
  answer, the same for every app.
- Bad, because each source's old tables live beside the new model until it is retired; the
  retirement is part of the step that absorbs it, never left for later.

### Confirmation

Each unification step lists the features it absorbs and the tables it retires; the review checks
nothing new is written into an absorbed feature.

## More Information

Doctrine D-056 to D-058; kete-core decision 0011 and phase 10 of its roadmap. A complete simulation
of the flow is validated by the author before the code; the author, then KYA, test at the end.
