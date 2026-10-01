# Feature Specification: The structure of an organization

**Feature Branch**: `002-structure`
**Created**: 2026-10-01
**Status**: Delivered (proof on staging pending)
**Input**: Doctrine D-028 (Kete Enterprise knows where a person is in the company), D-041 (generic
primitives: organization, units with configurable types, positions, dated assignments), ARCHITECTURE
§13 (structure: legal entities, countries, units, positions, dated assignments — primary,
functional, project, interim, delegation — and reporting lines that cross entities).

## Why

Everything after depends on it: rights have a scope in this tree (003), approvers are found through
it (005), resources and controls have an owner and a scope in it (004, 008). It must be true at a
date, because people move and the past must stay readable.

## User Scenarios & Testing

### User Story 1 — An administrator draws the organization (P1)

1. **Given** an owner or admin of the organization, **When** she creates unit types (group, legal
   entity, country office, branch, department, team, project…), units under one another, positions
   in units, and people, **Then** the chart shows them, as of today.
2. **Given** a unit, **When** it is moved under another unit, **Then** it carries its subtree; moving
   a unit under itself or one of its descendants is refused.

### User Story 2 — Assignments are dated (P1)

1. **Given** a person, **When** she is assigned to a position with a kind (primary, functional,
   project, interim, delegation) from a date, and later the assignment ends, **Then** the chart as of
   any date shows who held what then.
2. **Given** a person with a primary assignment, **When** a second primary assignment would overlap
   it, **Then** it is refused: a person has one primary position at a time.
3. **Given** a position reporting to a position in another unit or legal entity, **Then** the
   reporting line is kept: lines cross entities.

### User Story 3 — Safe and traced (P1)

1. **Given** a member who is neither owner nor admin, **Then** she reads the chart and changes
   nothing (scoped rights arrive with spec 003).
2. **Given** any change, **Then** it is a named command in the journal: who, through which channel,
   when; retrying with the same idempotency key does nothing twice.
3. **Given** two organizations, **Then** neither sees nor references the other's units, positions,
   people or assignments.

## Requirements

- **FR-001**: tables `unit_types`, `units`, `positions`, `people`, `assignments`, each with
  `organization_id`, its RLS policy in the same migration, composite foreign keys within the
  organization, and no deletion (things close at a date).
- **FR-002**: commands `create-unit-type`, `create-unit`, `move-unit`, `close-unit`,
  `create-position`, `close-position`, `add-person`, `assign-person`, `end-assignment`.
- **FR-003**: `GET /v1/structure?asOf=YYYY-MM-DD` gives the chart at a date; `POST` routes run the
  commands with an `Idempotency-Key`.
- **FR-004**: a person's account is optional: people without a Compte Kete (field staff) appear in
  the chart; a person with one is linked by her account's identifier.
- **FR-005**: the screen « Structure »: the tree with its positions and holders at a date, and the
  forms to draw it, in French and English.

## Out of scope

- Scoped roles and who may change which part of the tree: spec 003.
- Importing a chart from a file: when a real chart is too large to enter by hand.

## Success Criteria

- **SC-001**: tests prove the rules (tree, dates, one primary at a time), the journal, idempotency
  and the isolation between organizations.
- **SC-002** `[blocking]`: KYA's chart entered on staging, dated.
