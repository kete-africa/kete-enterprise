# Feature Specification: Rights with a scope

**Feature Branch**: `003-rights`
**Created**: 2026-10-01
**Status**: Delivered (proof on staging pending)
**Input**: Doctrine D-028 (rights with a scope), ARCHITECTURE §13 (roles with a scope — subtree,
country, project; each resource's owner and scope; an agent never has more rights than the person
or the manager it acts for), principle 4.

## Why

A company is not flat: a branch manager runs his branch, an HR officer of the Togo entity manages
Togo's people, a project lead his project. Rights follow the structure (spec 002), so they follow
people when they move.

## User Scenarios & Testing

### User Story 1 — A role, granted with a scope (P1)

1. **Given** an organization's administrator, **When** she defines a role (a name and its
   permissions) and grants it to a position or a person, on a unit's subtree, a country, or the
   whole organization, from a date, **Then** whoever holds that position (or that person) has those
   permissions there, and nowhere else.
2. **Given** a grant to a position, **When** its holder changes (spec 002 assignments), **Then** the
   rights move with the position: the new holder has them, the former one no longer does.
3. **Given** a grant that ends, **Then** its rights end at that date.

### User Story 2 — The structure under rights (P1)

1. **Given** a branch manager granted « structure:read » on his branch, **Then** he sees his branch
   and what is under it, and nothing else of the organization.
2. **Given** an HR officer granted « structure:write » on the Togo entity, **Then** she draws Togo's
   units, positions and assignments, and is refused elsewhere.
3. **Given** a person without any grant, **Then** she sees the units where she holds a position.

### User Story 3 — Administrators and traces (P1)

1. **Given** an owner or admin of the organization at the Compte Kete, **Then** she holds every
   permission everywhere: she is the one who grants the others.
2. **Given** any change to roles or grants, **Then** it is a named command in the journal.
3. **Given** two organizations, **Then** neither sees the other's roles or grants.

## Requirements

- **FR-001**: tables `roles` (name, permissions) and `role_grants` (a role, to a position or a
  person, scoped to a unit's subtree, a country, or everywhere; dated), with RLS.
- **FR-002**: commands `create-role`, `set-role-permissions`, `grant-role`, `revoke-grant`;
  permissions are checked against the catalog the features declare.
- **FR-003**: one evaluation for every feature: a person's rights for a permission at a date —
  everywhere, or the set of units covered.
- **FR-004**: the structure (spec 002) uses it: its chart is filtered by `structure:read`, its
  gestures checked by `structure:write` on the units they touch.
- **FR-005**: `GET /v1/rights/me` says what the person may do and where; the screen « Droits »
  lets an administrator define roles and grant them.

## Out of scope

- Agents' own grants and their narrowing (spec 007); resources' owners and scopes (spec 004).

## Success Criteria

- **SC-001**: tests prove the scopes (subtree, country, everywhere), the rights following the
  holder of a position, the dates, the structure filtered and checked, and the isolation.
- **SC-002** `[blocking]`: on staging, a branch manager of KYA sees his branch only.
