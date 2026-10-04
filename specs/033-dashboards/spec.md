# Spec 033 — Dashboards

## Why

« Make me an SAV dashboard. » A dashboard is a few cards over the organization's data — a team's
tables (spec 031b), a form's answers (spec 032) — each one small query and a way to show it.
Anyone composes one; her assistant proposes one, which she keeps or not; an administrator opens it
to others. Each card is read with **the reader's** rights: a shared dashboard never shows a figure
its reader may not read. Built on team data's query and Apache ECharts (Apache-2.0, in the browser,
in the design's colors).

## The flow

```mermaid
sequenceDiagram
  participant P as Person
  participant A as Assistant
  participant E as Kete Enterprise
  participant R as Reader
  P->>A: « Fais-moi un tableau de bord SAV »
  A->>E: team_datasets — real columns
  A->>E: dashboard_propose (cards) — level 2, a proposal
  P->>E: POST /v1/dashboards/:id { keep } · or a new card
  P->>E: (an administrator) { audience: [everyone] }
  R->>E: GET /v1/dashboards/:id
  E->>E: each card: queryDatasetFor / queryFormFor — with R's rights
  E-->>R: figures she may read; « no access » for the others
```

## Rules

- **Cards**: a title; a source (`dataset` or `form` and its id); the query (filters, up to three
  groups, up to six measures); a view (`number`, `bar`, `line`, `pie`, `table`). Twelve at most.
- **The reader's rights**: a team's table read only if its audience opens it to her; a form's
  answers only by who runs it. A card she may not read says so and shows nothing.
- **The assistant proposes**: `dashboard_propose` adds a dashboard « proposé » for her alone; she
  keeps it, changes it or removes it. It decides nothing.
- **Hers until opened**: her dashboards are hers; an administrator opens one to others.
- Off by default (`dashboards` module).

## Data

`dashboards`, with its row-level security, migration `0036_dashboards`.

## Interface

- **Tableaux de bord** (`/tableaux-de-bord`): hers and those opened to her; « Nouveau tableau de
  bord ».
- **A dashboard** (`/tableaux-de-bord/$id`): its cards — a figure, bars, a line, a pie, a table;
  for its owner: « Ajouter une carte », « Garder » a proposal, open it, remove it.

## Proof

`apps/api/tests/dashboards.test.ts`.
