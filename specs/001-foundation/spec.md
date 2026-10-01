# Feature Specification: Foundation

**Feature Branch**: `001-foundation`
**Created**: 2026-10-01
**Status**: In progress
**Input**: Doctrine D-025 (Kete Enterprise starts, KYA first), D-028 (its boundary), D-029 (its
technical choices), D-035 (the workspace design), D-040 (an app's identity card).

## User Scenarios & Testing

### User Story 1 — A person signs in and sees her organization (P1)

1. **Given** a person of an organization at the Compte Kete, **When** she opens Kete Enterprise,
   **Then** she signs in through the Compte Kete (or comes back silently), and the home page greets
   her and names her organization, as the API sees it.
2. **Given** a person without an organization, **Then** the API refuses (`no_organization`).

### User Story 2 — The API answers only to a person's token (P1)

1. **Given** no token, a forged one, or one from another issuer, **Then** `/v1/*` answers 401; an
   expired one says `token_expired` so the screens send the person to sign in again.

### User Story 3 — An instance installs and reports (P1)

1. **Given** the API image on an empty Postgres, **Then** it applies its migrations at start-up and
   `/health` reports healthy with its database.
2. **Given** `/.well-known/kete`, **Then** it serves a valid `manifest.v1` with its identity card
   (owner, data categories, AI use, criticality).

## Requirements

- **FR-001**: `apps/api` (Hono): `/health`, `/.well-known/kete`, `/v1/me` behind a person's token
  verified with the identity's published keys; migrations (kete-core's journal with its chain of
  agents, and the outbox) applied at start-up with the owner role.
- **FR-002**: `apps/web` (TanStack Start, workspace design, French and English): sign-in through the
  Compte Kete, the person's token kept server-side only, the home page from `/v1/me`.
- **FR-003**: CI: lint, types, formatting, catalogs, audit, tests on a plain Postgres, both images
  built and started healthy.
- **FR-004**: `deploy/docker-compose.yml`: an instance (Postgres, API, screens) from the images.
- **FR-005**: staging on Coolify from `dev`, on the Neon `dev` branch, signed in through the
  staging Compte Kete.

## Success Criteria

- **SC-001**: the API's tests pass on Neon `test` and on a plain Postgres.
- **SC-002** `[blocking]`: a person signs in on staging and sees her organization.
