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
- **Running**: `main.ts worker` runs the worker alone; `KETE_WORKER_IN_PROCESS=true` runs it beside
  the API (a small instance, one container).

Not yet: agents preparing drafts (level 3) and the enforcement of their budget, agents delegating to
agents — with the first agent that needs them.

## Routes

| Route                               | What                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `GET /v1/agents`                    | The agents acting for the person (all for a manager), signals                   |
| `POST /v1/agents`                   | `create-agent`: one's own; a position's or the system's needs « agents:manage » |
| `POST /v1/agents/:agentId/status`   | `update-agent-status`: pause or resume                                          |
| `POST /v1/agents/:agentId/wake`     | Wake it now                                                                     |
| `POST /v1/agents/signals/:id/close` | `close-signal`: its person marks it handled                                     |
