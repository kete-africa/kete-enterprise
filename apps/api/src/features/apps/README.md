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

- `appPermissions(db)`: the active apps of the registry that declare permissions, one per product.
- `appGrants(db, identity, product)`: managed once a role carries one of the app's permissions.
- `receiveAppEvent(db, clientId, event)`: kept once, only from the app the organization's registry
  holds under that client and product, only a type its card declares; `appNewsFor` counts them
  for a person's briefing, never a secret one.
- `openAppDecision`: an app's subject (`<product>.<subject>`) goes to the organization's circuit;
  once decided, the app is told the request's id at its callback (`tellAppsWith`).
