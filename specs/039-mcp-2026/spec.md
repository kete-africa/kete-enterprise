# Spec 039 — MCP 2026-07-28

## Why

The MCP revision of 2026-07-28 — stateless, multi-round-trip — is what Claude, ChatGPT and Codex
speak now. Kete Enterprise's gateway serves it through `@kete/capabilities` 0.4 (kete-core spec
059), and its assistant reaches the team's apps with the SDK v2 client. And the round trip serves
the doctrine: **a draft a copilot prepares is put to the person in her copilot**, and she decides.

```mermaid
sequenceDiagram
  participant C as Her copilot (Claude)
  participant P as Person
  participant G as Gateway /mcp
  C->>G: tools/call actions_propose (level 3)
  G-->>C: input_required · « Valider ce brouillon ? »
  C->>P: the form
  P-->>C: validate
  C->>G: the same call, with her answer
  G->>G: decided by her (channel view), journaled; traced once
  G-->>C: validated
```

## Rules

- The gateway serves 2026-07-28 and 2025-era clients; a level 3 draft is put to the person when
  her client can show a form, otherwise it waits in her To do (`/a-faire`), as level 4 always does.
- A call retried with her answer is traced once.
- The assistant's federation probes each app for 2026-07-28 and falls back to 2025.
- The Compte Kete knows copilots by their metadata document (kete-core spec 060): a person
  connects hers without anyone registering it.

## Proof

`apps/api/tests/gateway.test.ts` (a draft decided in her copilot), `apps/api/tests/views.test.ts`
(an app on the SDK v2).
