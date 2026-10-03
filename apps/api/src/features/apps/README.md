# The team's apps (spec 022)

What the organization's apps declare in their identity cards, and what they ask Kete Enterprise
with a person's token. See [the spec](../../../../../specs/022-app-permissions/spec.md).

| Route                          | What                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `GET /v1/apps/:product/grants` | `managed`, and what the person holds for the app, and where |
| `GET /v1/rights/permissions`   | (rights) the apps' permissions, by app, with their words    |

- `appPermissions(db)`: the active apps of the registry that declare permissions, one per product.
- `appGrants(db, identity, product)`: managed once a role carries one of the app's permissions.
