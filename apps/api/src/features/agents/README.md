# Agents (spec 007)

Agents with a job description, asleep until woken, acting for a person and never beyond her
(doctrine D-039, principles 3 and 4). The first ones read and signal (level 1); they change
nothing.

```mermaid
sequenceDiagram
  participant W as Worker (pg-boss, every 5 min)
  participant D as agents_due() — definer
  participant A as Agent (its organization's transaction)
  participant F as Watches (registry, decisions, …)
  W->>D: which agents are due?
  D-->>W: (organization, agent) — identifiers only
  W->>A: wake
  A->>A: whom does it act for today? (its person, or its position's holder)
  A->>F: what's wrong, in her reach ∩ its scope ∩ its permissions?
  F-->>A: findings (each with a key)
  A->>A: raise-signal for each new key; close-signal for each key gone
  A->>A: sleep until now + wakeEveryMinutes
```

- **Job description**: name, kind (`personal`, `position`, `system`), mission, the person who
  answers for it (or the position whose holder it acts for), scope (a unit and below), permissions,
  highest autonomy level, budget of open drafts, wake period, watches. Every agent enters the
  registry (spec 004) in its person's space.
- **Its reach**: what its person sees (spec 003), narrowed to its scope and to the watches whose
  permission its job description lists. It never acts as an administrator.
- **One organization**: an agent lives and acts in its own; the worker learns only identifiers
  across organizations, then works each agent in its organization's transaction.
- **Traced**: every signal raised or closed is a named command, its actor
  `{ kind: 'agent', id, onBehalfOf: its person, channel: 'worker' }`.
- **Watches** are the features': `registry` (apps without a card or an owner, needs
  `registry:read`), `decisions` (steps waiting too long for its person); compliance's controls plug
  in with `registerWatch` (spec 008).
- **Stopped**: an agent paused by its person does nothing; the organization's `agents` module
  switched off stops every agent at once (the kill switch), whoever wakes them.
- **Running**: `main.ts worker` runs the worker alone; `KETE_WORKER_IN_PROCESS=true` runs it beside
  the API (a small instance, one container).

**Tasks given (spec 036).** A person gives one of her agents a task; the worker runs it every
minute with her capabilities narrowed to its job description (permissions, autonomy, budget of
drafts), every commitment a draft she decides; it may hand part of it to another of her agents
(`delegate_task`, the chain carried, four agents at most); she sees each task's answer, steps and
drafts, is told when it ends, and stops it. See [spec 036](../../../../../specs/036-agents/spec.md).

## Autonomy per kind of task, its record, an agent from a sentence (spec 052)

```mermaid
flowchart LR
  J[Job description · permissions · autonomy max] --> L[Level per permission · 1 read · 2 act, undoable · 3 prepare]
  L --> G[Gateway: tool.autonomy ≤ min(max, its permission's level)]
  T[agent_tasks] & D[kete_drafts it prepared] & S[agent_signals] --> R[GET /v1/agents/:id/record]
  P[Her sentence] -->|POST /v1/agents/understand| F[A proposed job description · nothing created]
```

- **Per permission** (`autonomy_by_permission`, migration 0043): its person or a manager of agents
  sets a level for a permission it holds, never above its maximum; level 4, committing, is never
  set per kind of task. Without one, its maximum applies.
- **Its record**: the last 7 days by default (up to 90): tasks by outcome, drafts it prepared by
  decision, signals raised and closed.
- **From a sentence**: only the watches that exist and the permissions she holds, a maximum level
  of 3 at most; created only when she presses « Créer cet agent ».
