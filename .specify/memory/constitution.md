# Kete Enterprise — Constitution

> Derived from the Kete doctrine (repository `kete-africa/kete`: `docs/PRINCIPES.md`,
> `docs/CONCEPTION.md`, `docs/ARCHITECTURE.md` §13, `docs/DECISIONS.md`), and on
> kete-core's constitution, whose building blocks this repository uses. It governs the Spec Kit cycle
> (specify → clarify → plan → tasks → analyze → implement → converge). Every agent — Claude,
> Codex or any other — complies with it. Delivery principles win over technical elegance.

## Core Principles

### I. Simple and working — NON-NEGOTIABLE

Ship the simplest version that really helps someone. Nothing moves to the next step until the
current one is delivered, simple and working. Complexity without a real user asking for it is
refused.

### II. Build the current step only

A capability not needed to help someone **today** goes to the backlog, never into the current
implementation. Build only what has already hurt.

### III. Generic first, no vendor in the core — NON-NEGOTIABLE

Business code talks to **ports** (interfaces). Vendors (Chariow, Neon, Coolify, an AI model, an
e-mail provider…) live only in **adapters**. No vendor name in a domain or application layer.
*(doctrine D-014)*

### IV. Contract first

Everything a client, an app or an agent reaches goes through the API (doctrine D-029), described
and versioned; kete-core's contracts (`manifest.v1`, `capability.v1`, `event.v1`) are used as
they are, never redefined here.

### V. Security lives in the database — NON-NEGOTIABLE

The organization is the hard boundary. Every table carries its organization and is created **with
its RLS policy in the same migration**. The application connects with a role that cannot bypass
RLS. Nothing crosses organizations by default.

### VI. The AI prepares, a human decides

An agent never has more rights than the person it acts for. Autonomy follows reversibility:
reversible actions may run with a notification and an undo; irreversible, financial or external
actions go through a **draft** and an explicit, traced human validation. Every action records its
actor: who, on behalf of whom, through which channel.

### VII. Every instance stands alone

An instance runs on any Postgres 16 or more and any S3-compatible storage, installs itself, and
never calls Kete to work (doctrine D-026, D-029). It never reads another service's database;
integration events leave through an **outbox** written in the same transaction as the change.

### VIII. Nothing is claimed without proof

A feature is done only when its written proof is obtained. No invented figure, no invented
testimonial, in code, docs or product copy.

## Additional Constraints

- **TypeScript strict everywhere** (doctrine D-016, D-029): a Hono API on Node LTS, screens in
  TanStack Start with `@kete/design` (`workspace`), Zod, Postgres with pgvector, pg-boss, the
  official MCP SDK, Paraglide, Vitest, ESLint and Prettier; kete-core's packages for every
  mechanism they already provide (D-030).
- **Language** (doctrine D-020): code and all technical documentation are in **English**. User
  interfaces are in French, and in English through translation catalogs; no user-visible string is
  hard-coded.
- **Features are vertical slices** (doctrine D-015): each feature owns its layers and exposes a
  single public entry point (`index.ts`). Screens are purpose-built, never generated.
- **Named commands, never generic updates**: each command carries an idempotency key, its actor,
  and declares whether it is reversible and its inverse command.
- **No secret in the repository**, a message or a log. `.env.example` documents every variable.
- **Documentation with diagrams, in the same pull request** (doctrine D-017): Mermaid in Markdown;
  a package or feature without a `README.md` fails CI; generated docs are checked against the code.

## Development Workflow

- **Branches** (doctrine D-018): `main` (production, human-only, through Pono's guards), `dev`
  (integration, green CI required), `NNN-slug` (one Spec Kit feature, from `dev`).
- **Databases**: the Neon project `kete-enterprise` (branches `main`, `dev`, `test`) for Kete's
  own instances; CI proves the code on a plain Postgres. Migrations are versioned, additive, and
  applied at start-up.
- **Before each task**, the five questions: the one thing to ship; the simplest version that
  really helps; for the user or to impress; what would we keep if we shipped in three hours; will
  the person waiting be helped today.
- **Three-hour rule**: a task running beyond three hours without a visible deliverable is flagged
  as probable over-engineering.

## Governance

This constitution overrides any other practice in this repository. Complexity must be justified by
a real user, never by elegance. Amendments are dated and recorded in `docs/decisions/`, and must
not contradict the Kete doctrine; a conflict is resolved in the `kete` repository first.

**Version**: 1.0.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
