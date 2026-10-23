# Spec 110 — The catalogue and « Connexions », checked against the canvas

Screens of specs 104 and 105 compared on 2026-10-23 with canvas v7 (« Agents livrés », not yet
validated by the author) and with Kete's own screens (« Connexions » has no canvas screen).

## Requirements

- **FR-001 — A card per agent.** Its face, its name and who ships it, its mission, its sources in
  words (Kete's sets, an app by its name), what wakes it in the organization's words, what it takes
  on; grouped by who ships it. One column where the page is narrow.
- **FR-002 — A connection in words.** A connector reads on its schedule; a connection signals once
  its webhook is open; « Connexions » is marked in the Administration menu.

## Proof

`apps/api/tests/connections.test.ts` and `agents-sources.test.ts`; screenshots of the demo before and
after, beside canvas v7.

## Left for later

- v7's inventory of agents at work (budget, evaluation, state) and « Ce que … retient de vous ».
