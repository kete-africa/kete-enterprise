---
status: accepted
date: 2026-10-01
---

# An API that owns the data, and thin screens

## Context and Problem Statement

Doctrine D-029 decides a separate Hono API that the screens, the MCP gateway, agents and connected
apps consume. kete-core's app template is a full-stack TanStack Start app (its screens reach the
database through server functions). How is Kete Enterprise split?

## Considered Options

- The app template as it is, with a Hono API added beside it.
- **An API that owns the database, and thin screens that call it with the person's token.**

## Decision Outcome

Chosen: the API owns the database; the screens keep no data. Every client of Kete Enterprise — a
screen, Claude, an agent, a connected app — goes through the same door, under the same rights and
the same journal, so nothing reaches a company's data by a side path. kete-core's building blocks
are framework-free (D-030) and plug into Hono as they are.

### Consequences

- Good: one place where rights are checked; the screens can be replaced or multiplied.
- Bad: a screen makes an HTTP call where the template calls a function; the template's screens are
  reused piece by piece (sign-in, shell, catalogs), not wholesale.
- Tests: the API is tested on a real Postgres (Neon `test` locally, a plain Postgres in CI).
