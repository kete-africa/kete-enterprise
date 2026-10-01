# Kete Enterprise — project context

> The single place where this repository's context lives. `AGENTS.md` points here.

## What this repository is

**Kete Enterprise**: the chain of a company — what exists _between_ its tools (doctrine D-028). Its
structure (units, positions, dated assignments), its rights with a scope, its decisions (approval
circuits, Inbox), the registry of its resources (apps, skills, MCP, agents), its MCP gateway, its
agents with a job description, its compliance. It is the product handed to a client, under licence;
KYA is its first client, on its own servers (D-025).

## Read before any action

1. `.specify/memory/constitution.md` — the rules of this repository.
2. The Kete doctrine, repository `kete-africa/kete` (local: `../kete`): `docs/PRINCIPES.md`,
   `docs/ARCHITECTURE.md` §13, `docs/DECISIONS.md` (D-025 to D-030, D-035, D-039 to D-041).
3. `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/OPERATIONS.md` and `docs/decisions/`.

The doctrine is written in French; everything in this repository is written in English, and the
screens are in French (and English through the catalogs).

## Layout

```
apps/api/        the API (Hono, D-029): the one door for the screens, the MCP gateway, agents and
                 connected apps; it owns the database. src/features/<feature>: one vertical slice
                 each (structure, rights, decisions, registry, gateway, agents, compliance)
apps/web/        the screens (TanStack Start, workspace design): they call the API with the
                 person's token
apps/relay/      (later) at the client's: an outgoing connection only, it keeps their secrets
deploy/          Docker Compose: an instance installs itself (D-026)
docs/  specs/    architecture, decisions, roadmap, operations; Spec Kit features
```

kete-core's building blocks (`@kete/*`) come from GitHub Packages at their published versions, never
from a branch (D-034). Nothing here is needed by a Kete App: `kete-enterprise` depends on
`kete-core`, never the reverse (D-028).

## Branches

```
main       production — the human gesture only
dev        integration — green CI required before merging
NNN-slug   one Spec Kit feature, branched from dev
```

## Forbidden to agents

- Pushing to `main` or `dev` directly, or bypassing a branch protection.
- Writing a vendor name in a domain or application layer.
- Creating a table without its RLS policy in the same migration.
- Writing a secret in a file, a message or a commit.
- Hard-coding a user-visible string.
- Shipping a behavior change without its documentation and diagram.
- Letting an agent decide for a person, or hold more rights than the person it acts for.

## Tooling

- Node 22 · pnpm 11 · TypeScript strict · Vitest (`pnpm test`; `KETE_TEST_POSTGRES=container`, or
  the Neon `test` branch of the `kete-enterprise` project).
- Spec Kit `v0.16.0`, run through `uvx`, never from a global install. Procedures are available as
  the `speckit-*` skills.
