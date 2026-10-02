# Feature Specification: Performance — indicators, grids and the quarterly review

**Feature Branch**: `012-performance`
**Created**: 2026-10-02
**Status**: In progress
**Input**: KYA-ORG-CIBLE-01 v4 § 3.3–3.5 (three levels of indicators, quarterly review and variable
pay), KYA-KPI-01 (six attributes, colours that oblige, progressivity, revision rules, 46 positions
and 304 indicators), the IT service's indicators workbook (points per colour, a penalising line out
of the sum, protocols noted by the manager). Specs 010 (links) and 011 (surveys as sources).

## Why

Each quarter, every person — « du magasinier au DG » — is reviewed against written indicators, and
the review triggers her variable pay. Today the grids live in spreadsheets that break (`#DIV/0!`),
the values are retyped, and nobody can say which number rests on which source. An indicator whose
data is not produced reliably is « dead »; one that changes during the quarter ruins trust.

The tool makes the chain hold: one catalogue, grids frozen and notified before the quarter, values
entered once with their proof, colours computed the same for everyone, a written review signed by
both, validated by HR, and factors out — without anyone retyping a number.

## Concepts

- **Indicator**: the six attributes — formula, source, frequency, target, alert threshold, weight —
  plus its direction (higher or lower is better), whether its source is **reliable** (progressivity)
  and whether it is leading or lagging. A target or threshold that is not a number (« toute offre
  écartée ») keeps its words: the colour is then chosen by whoever measures.
- **Job profile** (« fiche de poste »): a position's grid template — 4 to 7 lines, weights summing
  to 100 %, possibly a penalising line (in the sum, or out of it as a coefficient 1 / 0.5 / 0), a
  blocking line (red sets the individual factor to 0) — and the variable pay split (individual,
  collective — direction, agency, service… — and group). Positions take a profile.
- **Quarter**: `T3 2026`, its dates, its scale of points per colour (green 100 %, orange 60 %, red
  0 % by default), whether progressivity applies (only reliable sources count; the others are shown
  « for observation »), the collective factor of each unit and the group's factor and trigger.
- **Review**: one per person holding a position with a profile, for a quarter. Opening the quarter
  **freezes** her grid (no change during the quarter, rule 5.2) and **notifies** it in writing: she
  acknowledges it by account or by link.
- **Colour**: green when the target is met; orange between target and threshold (action plan
  expected); red past the threshold (corrective action required); **no value = red**, charged to the
  management, never to the person.
- **Factors**: individual = Σ points of the counted lines (renormalised when progressivity leaves
  some out) × penalty coefficient (× 0 if a blocking line is red); then individual × weight +
  collective × weight + group × weight. Without a review, the average of the last two quarters, and
  HR is told (rule 3.4).

## User Scenarios & Testing

### User Story 1 — HR prepares the quarter (P1)

1. **Given** `performance:manage`, **When** HR imports a referential (or writes profiles), **Then**
   the catalogue, the profiles and their checks (weights = 100 %, 4 to 7 lines, six attributes) are
   there; positions take their profile by title.
2. **Given** a quarter in preparation, **When** HR opens it, **Then** each holder of a position with
   a profile gets her review with her grid frozen, and an e-mail with her personal link to read it.

### User Story 2 — Management control closes the measures (P1)

1. **Given** `performance:measure`, **When** the quarter has ended, **Then** management control
   enters each line's value with its proof — or takes it from a published survey (spec 011) — and
   each line gets its colour and points; enters each unit's collective factor and the group's.

### User Story 3 — The manager conducts the review (P1)

1. **Given** the N+1 of a person (whoever holds the position hers reports to), **Then** « My team »
   lists her people's reviews; she writes the record (facts, difficulties, support needed,
   protocols respected %), and signs.
2. **Given** a record signed by the manager, **Then** the person receives a link (or sees it in her
   space), adds her observations if she wishes, and signs. Both signatures are dated and journaled.

### User Story 4 — HR validates, factors come out (P1)

1. **Given** `performance:validate`, **When** HR validates the signed reviews (consistency across
   directions), **Then** each person's factors are frozen and exported; the reviews not held get the
   average of their last two quarters and are flagged as a management failure.

### User Story 5 — Everyone sees where she stands (P2)

1. **Given** a person, **Then** « My performance » shows her grid, colours, points and factors.
2. **Given** `performance:read` (the Codir), **Then** the quarter's board shows, per direction and per
   person, the factors and the lines in red.

## Requirements

- **FR-001**: tables `indicators`, `job_profiles`, `profile_lines`, `position_profiles`,
  `performance_quarters`, `quarter_units` (collective factors), `reviews`, `review_lines`, with RLS.
- **FR-002**: commands `import-referential`, `assign-profile`, `create-quarter`, `open-quarter`,
  `acknowledge-grid`, `record-measure`, `set-collective-factor`, `close-measures`,
  `write-review`, `sign-review` (manager, then person), `validate-review`, `close-quarter`.
- **FR-003**: permissions `performance:manage`, `performance:measure`, `performance:validate`,
  `performance:read`; module `performance`. The manager's right comes from the structure.
- **FR-004**: personal link purpose `performance.review`, reference the review: read the grid,
  acknowledge it, read and sign the record.
- **FR-005**: screens: Space › Performance (quarters, profiles, measures, validation, board),
  Space › My team, « My performance » on the home page, the link page.
- **FR-006**: the KYA demo imports KYA-KPI-01 and the IT workbook's two profiles.

## Out of scope

- The amount of variable pay (a later compensation module consumes the factors).
- Computing values automatically from the systems of record: each line keeps its source; apps feed
  values through the API (`kete-helpdesk` for the ticket indicators).
