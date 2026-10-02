# Feature Specification: Meetings, decisions and the action register

**Feature Branch**: `013-meetings`
**Created**: 2026-10-02
**Status**: In progress
**Input**: KYA-ORG-CIBLE-01 v4 § 3.1–3.2 (the instances: Codir monthly with a quorum and a record
of decisions within 48 h, each action with an owner and a deadline; the weekly operational review;
the management review of ISO 9001 § 9.3; the extended committee; brainstorming sessions), principle
P5 (« mesurer avant de réunir » — the meeting decides on gaps, it does not report orally), KYA's
numbered decision notes (`2026-010/DG/KEG`), KYA-KPI-01 § 1.5 (orange calls for an action plan, red
for a corrective action). Specs 008 (compliance checks) and 012 (indicators).

## Why

Decisions get lost between a meeting and the next: who does what by when is in someone's notebook,
the record arrives a week later, and the auditor asks for the management review's evidence. The
measure exists (spec 012); the meeting must start from its gaps, end with dated actions, and leave
evidence without anyone writing a report about it.

## User Scenarios & Testing

### User Story 1 — A meeting starts from the gaps (P1)

1. **Given** `meetings:manage`, **When** the secretary plans a meeting of a type (Codir, weekly
   review…), **Then** its agenda is drawn from the gaps: the units with indicators in red in the
   last measured quarter, and the actions past due; she adds her own items.
2. **Given** a meeting held, **When** she records who was present, **Then** the quorum of its type
   is checked and said.

### User Story 2 — Decisions become actions (P1)

1. **Given** a meeting held, **When** a decision is recorded with an owner and a deadline, **Then** it
   becomes an action in the register, in its owner's « To do ».
2. **Given** the record published, **Then** it is on time or late against its type's delay (48 h for
   the Codir), and it stays readable by everyone concerned.

### User Story 3 — One register of actions (P1)

1. **Given** the actions of meetings, of indicators (closing a quarter's measures opens a plan of
   action for each review with reds or oranges, owned by the person's manager) and of audits
   (spec 008's corrective actions), **Then** one register lists them, with what is overdue.
2. **Given** an action's owner, **When** she closes it with what was done, **Then** it is done.

### User Story 4 — Decision notes (P1)

1. **Given** a draft note (subject, text, signatory), **When** it is published, **Then** it takes the
   next number of the year (`2026-012/DG/KEG`, the code being the organization's top unit's) and
   everyone sees it; each person acknowledges having read it, and the count is kept.

### User Story 5 — Evidence without writing it (P2)

1. **Given** the compliance checks (spec 008), **Then** new automatic checks read these registers:
   a management review held and recorded in the last six months (§ 9.3), records published on time,
   actions not overdue (§ 10.2), quarterly reviews held (§ 7.2), customer satisfaction measured in
   the last six months (§ 9.1.2).

## Requirements

- **FR-001**: tables `actions`; `meeting_types`, `meetings`, `meeting_decisions`,
  `decision_notes`, `note_reads`, with RLS.
- **FR-002**: commands `create-action`, `complete-action`, `cancel-action`; `define-meeting-type`,
  `plan-meeting`, `add-agenda-item`, `hold-meeting`, `record-decision`, `publish-record`,
  `draft-note`, `publish-note`, `read-note`.
- **FR-003**: permissions `meetings:manage`, `meetings:publish` (decision notes); module `meetings`.
- **FR-004**: spec 012's `close-measures` opens the action plans.
- **FR-005**: screens: Space › Meetings (types, meetings, the meeting, notes), « To do » lists my
  actions and the notes to read; the register of actions.
- **FR-006**: the KYA demo gets the instances of § 3.1.

## Out of scope

- Calendar invitations; minutes typed live by an agent (later, with the assistant).
