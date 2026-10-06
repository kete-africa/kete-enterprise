# Spec 056 — « Comment ? »

## Why

A person trusts what was done for her when she can see how it was done. Until now an agent's task
showed its instruction, its answer and its drafts. « Comment ? », beside anything an agent did,
now shows who asked, each step with the right it used and how far it was allowed to go alone, what
it read, what it did alone as the journal keeps it, what waits for her decision, and the rights of
its job description.

Nothing is rebuilt after the fact: « Comment ? » shows what was recorded when the task ran.

Built on what exists: the agents' tasks (spec 036) and their autonomy per kind of task (spec 052),
`@kete/commands`' journal and its trace, the capabilities' permissions and levels
(`@kete/capabilities`), the sources a tool's output names (spec 048).

## What is recorded, and what is shown

```mermaid
flowchart LR
  subgraph when the task runs
    R[runTask] -->|each tool called| S[step: tool · status · permission · level · sources]
    R -->|every command it runs alone| J[(kete_commands · trace_id)]
    S --> T[(agent_tasks.steps)]
  end
  subgraph « Comment ? »
    T --> H[howOf]
    J -->|this task's trace, this agent's lines| H
    A[its job description: permissions · highest level] --> H
    H --> D[GET /v1/agents/tasks/:taskId/how]
    D --> P[the dialog: who asked → steps → gestures → end · rights]
  end
```

## Rules

- **Who reads it**: whoever may see the agent — the person it acts for, or who manages agents.
  A colleague is refused.
- **Who asked**: its person (« Demandé par vous » when she is the reader), or the agents that
  handed the work on, the first one first.
- **A step** says the tool, what came of it (done, a draft prepared, refused, handed on), the
  permission the tool asks for, its level — read only, act when it can be undone, prepare and she
  decides — and up to five sources its result names, as links she can open with her own rights.
- **What it did alone**: the commands journaled under the task's trace by this agent, with their
  time and whether they can be undone. Every task's gestures now carry its trace, delegated or not;
  a delegated work shares one trace, so each agent's « Comment ? » keeps to its own lines.
- **Honest about the past**: a task that ran before this spec has steps without a permission, a
  level or sources, and gestures without a trace; they show as they were recorded, nothing is
  guessed. Steps carry no time of their own: only the task's moments and the journal's lines do.
- **Its rights**: the permissions of its job description and its highest level, in the words of
  the rights screen.
- **Not in this spec**: the assistant's own answers already show their plan, their steps and
  their sources in the chat (specs 048 and 053); a routine's run keeps its cause and its summary
  (spec 051), not its steps.

## The screens

- **« Aujourd'hui »**, « Fait pour vous »: « Comment ? » beside each task an agent finished.
- **« Mes agents »** (and « Agents » for who manages them): « Comment ? » under each task that
  started.

## Proof

- `tests/agent-tasks.test.ts`: a task's « Comment ? » gives its step with the permission and the
  level of the tool, its drafts, its rights, asked by its reader; a colleague is refused; a
  reversible command an agent ran alone shows as a gesture of that task and of no other; a task
  handed on names the agent that handed it.
