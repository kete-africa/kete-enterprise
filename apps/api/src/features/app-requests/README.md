# App requests (spec 021)

A person asks for an app; IT decides; the app factory creates it and reports each step, signed.
See [the spec](../../../../../specs/021-app-factory/spec.md) for the flow and its diagram.

| Route                                       | Who                                   |
| ------------------------------------------- | ------------------------------------- |
| `GET /v1/app-requests`                      | anyone: hers; IT: to decide and all   |
| `GET /v1/app-requests/:requestId`           | the person who asked, and IT          |
| `POST /v1/app-requests`                     | anyone (`submit-app-request`)         |
| `POST /v1/app-requests/:requestId/withdraw` | the person who asked, until decided   |
| `POST /v1/app-requests/:requestId/decide`   | `registry:review`, never her own      |
| `POST /v1/app-requests/:requestId/send`     | `registry:review`, approved or failed |
| `POST /public/factory/reports`              | the factory only, signed              |

- **Signed both ways**: Kete Enterprise signs what it sends with `FACTORY_KID`/`FACTORY_SECRET`
  (product `prd_kete_enterprise`); it accepts reports signed with the same key as
  `prd_kete_factory`.
- **Ready** registers the app in the registry as a service acting for the requester: she owns it.
