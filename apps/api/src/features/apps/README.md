# The team's apps (specs 022, 023, 025)

What the organization's apps declare in their identity cards, and what they ask Kete Enterprise
with a person's token. See [the spec](../../../../../specs/022-app-permissions/spec.md).

| Route                          | What                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `GET /v1/apps/:product/grants` | `managed`, and what the person holds for the app, and where |
| `GET /v1/rights/permissions`   | (rights) the apps' permissions, by app, with their words    |

| `POST /v1/apps/:product/decisions` | a decision the app asks for the person (spec 023) |
| `GET /v1/apps/:product/decisions/:requestId` | where it stands, for the person who asked |
| `POST /public/apps/events` | the app's events, with its own token (spec 025) |
| `GET /public/apps/:organizationId/decisions/:id` | the outcome, read with the app's own token |
| `PUT /public/apps/holdings` | every thing the app holds now, with its own token (spec 091) |
| `POST /v1/apps/:product/gestures` | a gesture the app is about to make, through the policies (spec 091) |

- `appPermissions(db)`: the active apps of the registry that declare permissions, one per product.
- `appGrants(db, identity, product)`: managed once a role carries one of the app's permissions.
- `receiveAppEvent(db, clientId, event)`: kept once, only from the app the organization's registry
  holds under that client and product, only a type its card declares; `appNewsFor` counts them
  for a person's briefing, never a secret one. A kept event that is not secret goes on the one event
  path (`features/events`, spec 101) with the object it names.
- `openAppDecision`: an app's subject (`<product>.<subject>`) goes to the organization's circuit;
  once decided, the app is told the request's id at its callback (`tellAppsWith`).

## « Apps » (spec 070)

`GET /v1/apps` (`appsFor`, `listing.ts`): what stands behind the center for the person — the packs
switched on that her rights open (`packs`: where each opens, the prefix of its permissions), the
team's apps of the registry, the connected connectors — each with what the center receives: what
waits for her (`app_tasks` by source), the capabilities agents may call (the gateway's list), a watch.

## The living model (spec 091)

`receiveAppHoldings` keeps an app's holdings in step with what it says it holds (`syncSource` of
`@kete/work`): only from the app the registry holds under that client and product, each a
`holding.v1` under its product; what it no longer says is finished; a holder the center does not
know is refused, never kept for nobody. `checkAppGesture` asks the policies about an app's gesture
for the person or her agent: `unruled` while no policy in force speaks of it (`ruledHere`), else
the engine's verdict — journaled — with the policies' sentences and who approves.
