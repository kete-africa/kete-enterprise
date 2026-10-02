# Feature Specification: Readings from connected apps

**Feature Branch**: `015-app-readings`
**Created**: 2026-10-02
**Status**: In progress
**Input**: KYA's IT service asks the Codir for « un ticketing horodaté » because without it its
indicators are « dead » (KYA-Indicateurs-Service-Informatique, Demandes au CODIR). An app created
by a person — `kete-helpdesk` — must feed the indicators without anyone retyping a number, and
without becoming the one who decides the measure (management control keeps the arrêté).

## User Scenarios & Testing

1. **Given** a connected app acting for a person (her token), **When** it sends a reading — a
   quarter, an indicator of the organization's catalogue, a value, its proof, its source — **Then**
   it is kept, append-only; an unknown indicator is refused.
2. **Given** management control (`performance:measure`), **Then** the review of a quarter shows,
   under each line, the readings sent for its indicator; taking one writes its value and its proof
   (« kete-helpdesk — 37 tickets rétablis, 34 dans le délai ») and the colour follows.

## Requirements

- **FR-001**: table `indicator_readings` with RLS, append-only for the application role.
- **FR-002**: `POST /v1/performance/readings` (anyone of the organization, through a connected
  app), `GET /v1/performance/readings?quarter=` (manage, measure, read),
  `POST /v1/performance/reviews/:id/from-reading` (measure).
