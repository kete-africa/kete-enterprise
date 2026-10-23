# Spec 105 — One connection, three uses

Doctrine D-062 (R8): an external tool is connected once and serves to read, act and signal —
three permissions on the connection, act never granted by default; (R17) a connection that fails
says so where it serves. Kete-core ADR 0019 and spec 147 give the grants and the signed webhook.

## Requirements

- **FR-001 — One view.** `GET /v1/connections` (administrators): each imported tool set, and each
  connector on its address as its signal, once — its uses and its health.
- **FR-002 — Act is granted.** A set reads at connection; each act tool is granted by an
  administrator at a level (1 to 3, never alone); the gateway and the agents receive only what is
  granted. The sets imported before keep their act tools, as drafts.
- **FR-003 — A webhook.** A secret per connection, said once, sealed, never journaled.
- **FR-004 — Its events.** A signed event is kept once on the event path with its object; unsigned,
  signed by another, or for an unknown connection, it is refused alike.

## Proof

`tests/connections.test.ts`: the view refused to a member, the CRM reading and acting nowhere;
a grant refused for a read tool and for a level that would act alone, then given; the webhook's
secret said once and absent from the journal; a signed event kept once with its object, a replay a
duplicate, an unsigned or foreign one refused. `tests/tools.test.ts`: the CRM's act tools reach the
gateway only once granted.

## Left for later

- One table for the connections — the tool sets, the connectors, the AI and mail credentials — on
  `@kete/connections`' store and one seal; external types mapped to the center's (« a customer is a
  party ») with a merge proposal a person confirms (R13); a connection's spend metered (R18).
