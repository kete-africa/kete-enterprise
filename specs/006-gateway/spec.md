# Feature Specification: The MCP gateway

**Feature Branch**: `006-gateway`
**Created**: 2026-10-01
**Status**: In progress
**Input**: Doctrine D-028 (its MCP gateway), ARCHITECTURE §13 (one MCP address per person, which
exposes only what her scope allows; every call authorized and traced), D-037 (MCP Apps views),
principle 4 (an agent never has more rights than the person).

## Why

People already work with Claude or ChatGPT. The gateway lets them reach their company through it,
without a side door: the same rights, the same journal, the same autonomy rules as the screens.

## User Scenarios & Testing

### User Story 1 — A person connects her copilot (P1)

1. **Given** a person, **When** she adds Kete Enterprise's MCP address to Claude, **Then** her
   copilot is sent to sign in with her identity (OAuth, RFC 9728 metadata), and comes back with her
   token.
2. **Given** her token, **Then** the tools listed are only those her rights allow: what she sees of
   the structure, of the registry, and her Inbox.

### User Story 2 — The copilot acts for her, within her rights (P1)

1. **Given** her copilot, **When** it reads the structure, **Then** it sees what she sees, nothing
   more; **When** it registers a resource, **Then** it lands in her personal space, as an agent
   acting for her, in the journal.
2. **Given** the copilot, **Then** it never decides a request in her Inbox: decisions are a
   person's (spec 005).

### User Story 3 — Every call traced (P1)

1. **Given** any call to a tool, **Then** the gateway records who, through which client, which
   tool, when, and whether it was allowed; the person reads her own trace.

## Requirements

- **FR-001**: `/mcp` on the API (MCP over HTTP), behind a person's token; without one, a 401 that
  names the protected resource metadata (`/.well-known/oauth-protected-resource`).
- **FR-002**: capabilities (`@kete/capabilities`): `structure_chart` (level 1), `registry_list`
  (level 1), `registry_register` (level 2, undone by retiring), `decisions_inbox` (level 1).
  Rights are the person's (spec 003), checked for every call.
- **FR-003**: table `gateway_calls` (who, client, tool, allowed, when), with RLS; `GET
  /v1/gateway/calls` gives the person her own calls.
- **FR-004**: the home screen shows the gateway's address and how to add it to a copilot.

## Out of scope

- Deciding through a copilot's view (level 3 drafts with MCP Apps): when a subject needs it.
- Agents' own identities and narrowed tokens: spec 007.

## Success Criteria

- **SC-001**: tests prove the listing by rights, the chart as the person sees it, registration in
  her space as her agent, the 401 with its metadata, and the trace.
- **SC-002** `[blocking]`: on staging, Claude reads a KYA person's structure within her scope.
