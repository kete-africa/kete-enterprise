# Roadmap

One Spec Kit feature at a time, each delivered and proven before the next (constitution I and II).
KYA is the first client (doctrine D-025): each proof is obtained on KYA's real organization.

| Spec             | Delivers                                                                                                                                                           | Proof                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `001-foundation` | The repository, CI, the API (`/health`, manifest with its identity card, a person's token), the screens signed in through the Compte Kete, Docker Compose, staging | A person signs in on staging and sees her organization |
| `002-structure`  | Legal entities, units with configurable types, positions, dated assignments, relationships (D-041)                                                                 | KYA's organization chart entered, dated                |
| `003-rights`     | Roles with a scope (subtree, country, project), each resource's owner and scope                                                                                    | A branch manager sees his branch only                  |
| `004-registry`   | The inventory of apps, skills, MCP and agents from their identity card; submission from Claude; promotion by tiers                                                 | KYA's apps inventoried, those without an owner flagged |
| `005-decisions`  | Approval circuits described as data, the Inbox                                                                                                                     | A request approved by the right person, by threshold   |
| `006-gateway`    | One MCP address per person, limited to her scope                                                                                                                   | Claude acts for a person, within her scope             |
| `007-agents`     | Agents with a job description, woken by events, narrowing delegations, a budget of drafts (D-039); the first one watches the controls (level 1)                    | The agent flags a failing control                      |
| `008-compliance` | Frameworks, requirements, shared controls, evidence from the journals, documents, audits, findings, corrective actions, certificates (D-040)                       | A pilot framework's controls and their evidence        |

## Later, when a real need appears

The internal chat and knowledge (`assistant`, `knowledge`), finance and HR operations with the books
through a port, the relay (`apps/relay`), the instance's administration (install, update, backup,
licence), `@kete/enterprise-sdk` for connected apps, the fleet console in Kete Cockpit (D-027).
