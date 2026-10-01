# Feature Specification: Compliance, a controls engine

**Feature Branch**: `008-compliance`
**Created**: 2026-10-01
**Status**: Delivered (proof on staging pending)
**Input**: Doctrine D-040 (one model for every compliance — framework, requirement, control,
evidence, finding, corrective action, audit; a control serves several frameworks; everything has a
scope; evidence is a record; no standard's text ever shipped; controls and their evidence, never a
percentage; a pilot framework first), D-039 (the first permanent agent watches the controls), the
author's validation of « compliance/ » with controlled documents and certificates.

## Why

Eight standards treated apart make eight compliance systems and the same evidence eight times. One
library of controls, linked to every framework that asks for them, with evidence drawn from what
the company already records, builds compliance while working — not the week before the audit.
Kete prepares and proves; only an accredited body certifies.

## User Scenarios & Testing

### User Story 1 — Frameworks and shared controls (P1)

1. **Given** a compliance manager, **When** she records a framework (ISO 9001, a law, an internal
   policy, a client's requirements) and its requirements — each a clause reference and a summary
   in the company's own words — **Then** they exist for the organization, with a scope.
2. **Given** a control (what is checked, by whom, how often, automatically or by attestation),
   **When** it is linked to requirements of several frameworks, **Then** one piece of evidence for it
   serves them all.

### User Story 2 — Evidence (P1)

1. **Given** an automatic control, **When** the evidence is collected, **Then** the check reads the
   company's own records (the registry, the decisions, the agents, the structure, the corrective
   actions), and the evidence keeps its outcome, its summary, its fingerprint (SHA-256), who
   collected it and until when it is valid.
2. **Given** an attested control, **When** the holder of its owner position (or a manager) attests,
   **Then** the attestation is evidence in the same way.
3. **Given** a control, **Then** its status is « passing », « failing », « expired » (its evidence
   is too old) or « missing »; a framework shows its requirements with their controls and statuses,
   never a percentage.

### User Story 3 — Documents, audits, findings, corrective actions, certificates (P1)

1. **Given** a controlled document (a policy, a procedure), **When** a version is written and then
   approved by someone other than its author, **Then** it becomes current; the former one becomes
   obsolete; every version keeps its fingerprint.
2. **Given** an audit (internal or external, on a framework and a scope), **When** findings are
   raised (major, minor, observation) and corrective actions assigned with a due date, **Then** an
   action is done by its owner and its effectiveness verified by someone else; a finding closes when
   its actions are verified.
3. **Given** a certificate (body, number, scope, dates), **Then** its expiry and next surveillance
   audit are known.

### User Story 4 — The controls watch (P1)

1. **Given** an agent whose job description lists the « compliance » watch and « compliance:read »,
   **When** it wakes, **Then** it signals the controls failing, expired or missing, the corrective
   actions overdue and the certificates expiring within sixty days — and changes nothing.

## Requirements

- **FR-001**: tables `frameworks`, `requirements`, `controls`, `control_requirements`, `evidence`
  (append-only), `documents`, `document_versions`, `audits`, `findings`, `corrective_actions`,
  `certificates`, each with RLS.
- **FR-002**: named commands for every gesture; permissions `compliance:read`, `compliance:manage`.
- **FR-003**: automatic checks declared in code (`registry.apps_have_card`, `decisions.no_overdue`,
  `agents.act_for_someone`, `structure.positions_filled`, `compliance.actions_on_time`).
- **FR-004**: the « compliance » watch for the agents (spec 007).
- **FR-005**: the screen « Conformité ».

## Out of scope

- The text of any standard: never (D-040). Frameworks for sale as packs: when a client asks.
- Storing files as evidence (S3): when a control needs a file; versions of documents are text.

## Success Criteria

- **SC-001**: tests prove a control serving two frameworks, automatic and attested evidence with
  their fingerprints and statuses, the document's four eyes, findings closed by verified actions,
  certificates, the controls watch, and isolation.
- **SC-002** `[blocking]`: KYA's pilot framework (chosen by the author) entered on staging, with its
  controls and their evidence.
