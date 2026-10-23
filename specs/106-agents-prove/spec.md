# Spec 106 — One memory, a budget, and agents that prove themselves

Doctrine D-062 (R18, R21) and kete-core ADR 0018: an agent's memory of its person is hers —
private, viewable, erasable, kept only while she agrees; its spend is metered and capped; and it
proves itself on its real work before a change is trusted. Core already holds each piece
(`@kete/agents`' memory and evaluations, `@kete/ai`'s budgets); this spec puts them to work.

## Requirements

- **FR-001 — One memory.** Kete's and the agents' memory of a person is `@kete/agents`' one: what
  her assistant kept before moves there (her asking was her agreement). Shown to her with who
  noted each line; forgotten one by one, erased whole; her agreement given or withdrawn, with a
  retention. Withdrawn, nothing is read nor kept.
- **FR-002 — Agents read it, never in a group thread.** A task's prompt carries what she asked to be
  remembered — not in a thread several people read; an agent notes something only with her
  agreement.
- **FR-003 — A budget of its own.** Its monthly tokens, set by its person or a manager of agents,
  journaled; its spend this month shown. Spent, it stops and its person holds « demander plus ».
- **FR-004 — Its test set.** The cases its person writes (what it is asked, the gesture it must
  prepare, what it must never say) and what she accepted of its work.
- **FR-005 — Proof before trust.** Any change of its job asks an evaluation; the worker replays the
  cases with its person's rights, its tools played dry (nothing done); under 80 % it is paused
  « à revoir », the failures shown in its panel.

## Proof

`tests/agents-proof.test.ts`: her own note agreeing for her, shown to her alone; withdrawn, nothing
read; erased whole; a budget set by its person and refused to a colleague; a written case failing
after a change of job, the agent paused, nothing drafted.

## Left for later

- Budgets per unit and per person; « demander plus » routed to an administrator's « Décider ».
- An evaluation judged by meaning (a model as judge), in CI for Kete's own turn.
