# Feature Specification: The registry of resources

**Feature Branch**: `004-registry`
**Created**: 2026-10-01
**Status**: Delivered (proof on staging pending)
**Input**: Doctrine D-028 (the registry of a company's resources — skills, apps, MCP, agents — with
personal and team spaces, submission without Git, review according to risk, promotion by tiers of
the organization chart), D-040 (govern once, run anywhere: an app's identity card in its manifest),
kete-core spec 035 (`manifest.v1` governance).

## Why

AI multiplies what people create: apps, skills, MCP servers, agents. Without one inventory, nobody
knows what exists, who answers for it, what data it touches, or whether anyone still uses it. The
registry is where every resource enters, with an owner, a scope and a risk, before it spreads.

## User Scenarios & Testing

### User Story 1 — Anyone submits, in her own space (P1)

1. **Given** a person, **When** she registers a resource (an app, a skill, an MCP server, an agent)
   with a name, a description and, for an app or an MCP server, its address, **Then** it lands in
   her personal space, with her as its owner, visible to her.
2. **Given** an app's address, **Then** the registry reads its identity card
   (`/.well-known/kete`, `manifest.v1`): owner, data categories, use of AI, criticality; it derives
   the app's risk. An app without a card is flagged « unclassified ».

### User Story 2 — Promotion by tiers (P1)

1. **Given** a resource in a personal space, **When** its owner asks to promote it to a unit (her
   team, her branch) or to the whole organization, **Then** a person who may review resources there
   approves or refuses; approved, it is visible to everyone in that unit and below, or to all.
2. **Given** a high-risk resource, **Then** only a reviewer of the whole organization may promote it.
3. **Given** a resource no longer used, **Then** its owner or a reviewer retires it.

### User Story 3 — The inventory (P1)

1. **Given** a reviewer, **Then** she sees every resource in her reach, with its owner, tier, risk
   and status, and those without an owner or a card flagged.
2. **Given** two organizations, **Then** neither sees the other's resources.

## Requirements

- **FR-001**: tables `resources` (kind, name, description, address, owner, tier: personal, a unit
  or the organization; status; identity card and risk) and `promotions` (requested tier, decision),
  with RLS.
- **FR-002**: commands `register-resource`, `refresh-identity-card`, `request-promotion`,
  `decide-promotion`, `retire-resource`.
- **FR-003**: permissions `registry:read`, `registry:review` (rights, spec 003); everyone may
  register in her own space.
- **FR-004**: reading an identity card only from a public `https` address (never a private network).
- **FR-005**: the screen « Registre »: my resources, the inventory in my reach, the promotions to
  decide, and the form to register one.

## Out of scope

- Approval circuits with several steps and thresholds (spec 005 routes promotions through them).
- Submitting from Claude through MCP (spec 006 exposes these gestures as capabilities).

## Success Criteria

- **SC-001**: tests prove the spaces, the card read and the risk, promotion and its rights, the
  high-risk rule, retirement and isolation.
- **SC-002** `[blocking]`: KYA's apps inventoried on staging, those without an owner flagged.
