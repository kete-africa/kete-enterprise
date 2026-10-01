# Feature Specification: Approval circuits and the Inbox

**Feature Branch**: `005-decisions`
**Created**: 2026-10-01
**Status**: In progress
**Input**: Doctrine D-028 (decisions: approval circuits described as data — approver found by
relation or by role, thresholds, delegation, reminders — and the Inbox of humans and agents),
ARCHITECTURE §13, principle 3 (the more binding a gesture, the more present a person).

## Why

Decisions cross a company's tools: a promotion of an app, tomorrow an expense or a leave. Who
approves depends on the structure (the requester's manager, the holder of a role in the right
unit), on an amount, and on who is away. Written as data, one engine serves every subject; an
administrator changes a circuit without code.

## User Scenarios & Testing

### User Story 1 — A circuit described as data (P1)

1. **Given** an administrator, **When** she describes a circuit for a subject (« promotion of a
   resource ») as ordered steps, each naming its approver — the requester's manager, the holders of
   a role covering the request's unit, a position's holder, or a person — and, optionally, the
   threshold from which the step applies, **Then** every new request of that subject follows it.
2. **Given** a request whose measure is under a step's threshold, **Then** that step is skipped.

### User Story 2 — The Inbox (P1)

1. **Given** a pending request, **Then** it appears in the Inbox of the current step's approvers,
   found at the time they look: whoever holds the position then — including someone acting by
   interim or delegation — sees it.
2. **Given** an approver, **When** she approves, **Then** the request moves to the next applicable
   step, or is approved; **When** she refuses, **Then** the request is refused. Its subject is then
   carried out (for a promotion: the resource changes tier, or stays).
3. **Given** the requester, **Then** she never approves her own request; a step whose only
   approver would be her, or that finds nobody, goes to the organization's administrators.
4. **Given** a step waiting longer than its circuit's reminder delay, **Then** it is flagged
   overdue in the Inbox.

### User Story 3 — Promotions go through it (P1)

1. **Given** a circuit for « promotion of a resource », **When** a promotion is requested, **Then**
   it opens a request whose measure is the resource's risk (unknown and medium 2, low 1, high 3),
   so a step can apply to high risk only; the registry's direct review no longer applies to it.
2. **Given** no such circuit, **Then** promotions keep the registry's direct review (spec 004).

## Requirements

- **FR-001**: tables `circuits` (subject, name, reminder delay, active), `circuit_steps` (order,
  approver rule, threshold), `decision_requests` (subject, reference, requester, unit, measure,
  status) and `decision_steps` (each step's outcome, who decided, when), with RLS.
- **FR-002**: commands `define-circuit` (a new version replaces the active one for its subject),
  `decide-request`; requests are opened by the features (`openRequest`) in their own transaction.
- **FR-003**: permission `decisions:manage` for circuits; the Inbox is everyone's.
- **FR-004**: the screen « Inbox » (requests to decide, with their subject and history) and, for
  administrators, the circuits.

## Out of scope

- Sending reminders by e-mail or WhatsApp: the worker of spec 007 and the messages port.
- Agents in the Inbox: spec 007.

## Success Criteria

- **SC-001**: tests prove each approver rule, thresholds, delegation and interim, the
  requester never approving, the administrators' fallback, refusal, the promotion carried out,
  and isolation.
- **SC-002** `[blocking]`: on staging, a KYA promotion approved by the right person, by threshold.
