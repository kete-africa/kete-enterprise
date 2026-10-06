# Spec 052 — An agent's autonomy per kind of task, its record, an agent from a sentence

## Why

A person trusts her agent more for some things than for others: it may send a reminder to a
supplier alone — that can be undone — but should only prepare a letter to a client, and never
commit money. Spec 007 gave each agent one level for everything. Now its job description sets a
level per kind of task — per permission it holds — never above its own maximum. She also wants to
know, at the end of the week, what it did: tasks done or failed, drafts it prepared and what she
decided, what it signalled. And she wants to create one by saying what it should do.

Built on what exists: the agents and their job descriptions (spec 007), their tasks (spec 036),
the drafts of `@kete/drafts`, the gateway's tools and their autonomy levels.

## The screens

```mermaid
flowchart LR
  S[« Créer un agent en une phrase »] -->|POST /v1/agents/understand| P[Its job description and plan]
  P -->|« Créer »| C[POST /v1/agents · personal]
  A[An agent] --> L[Per permission: Lire · Agir, annulable · Préparer]
  L -->|POST /v1/agents/:id/autonomy| G[Gateway: tool.autonomy ≤ min(max, its permission's level)]
  A --> R[GET /v1/agents/:id/record · the last 7 days]
```

## Rules

- **Levels**: 1 read, 2 act where it can be undone, 3 prepare a draft she decides. Level 4,
  committing, is never set per kind of task: whatever is committed goes through a draft.
- **Per permission**: an agent's job description may set, for each permission it holds, a level
  lower than or equal to its maximum (`autonomy_by_permission`, migration 0043). The gateway gives
  the agent a tool only if the tool's level is within its permission's level, or within its
  maximum when none is set. Its person, or a manager of agents, sets it.
- **Its record** (last 7 days by default, up to 90): its tasks by outcome, the drafts it prepared
  for its person by decision (validated, refused, still open), the signals it raised and closed.
  Read by its person or a manager of agents.
- **From a sentence**: the model proposes a personal agent's job description — name, mission,
  watches from the catalog, permissions she holds, a maximum level of 3 at most — and a plan;
  nothing is created until she presses « Créer ».

## Proof

- `tests/agents.test.ts`: a level per permission narrows the agent's tools, never above its
  maximum; level 4 per permission refused; only its person or a manager sets it; its record counts
  its tasks, drafts and signals of the week; a sentence becomes a job description with only her
  permissions and known watches, nothing created before she asks.
