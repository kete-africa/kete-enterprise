# Feature Specification: The person's space, her assistant and her morning briefing

**Feature Branch**: `014-workspace-assistant`
**Created**: 2026-10-02
**Status**: In progress
**Input**: The demo for KYA's CEO: « chacun a son espace, son bot pour faire ce qu'il veut, ses
briefings au matin », and the team's resources — apps, data, skills — in one place. KYA's own
strategy (« AI for reasoning, software for deterministic execution »; « les droits appliqués à
l'humain s'appliquent aussi à l'IA agissant pour lui »), D-039 (agents act for a person, never with
more rights), D-029 (the model is configuration). Specs 006 (gateway) and 010–013.

## Why

The business tools exist; a person must not have to visit each to know what waits for her. Her
home says it, a briefing tells it every morning, and an assistant answers her questions — through
the same tools a copilot reaches by MCP, with her rights, never deciding for her. The model is a
choice of the instance; without one, the briefing is still written, by rules.

## User Scenarios & Testing

### User Story 1 — Home (P1)

1. **Given** a person, **Then** her home shows her morning briefing, what waits (forms, decisions,
   open and overdue actions, notes to read), her quarterly reviews, her team's, her apps and the
   last meetings' decisions — each read from the registers with her rights.

### User Story 2 — The morning briefing (P1)

1. **Given** a model configured, **Then** the briefing of the day is written by it from those
   facts, kept for the day, and refreshed on demand.
2. **Given** no model, or a budget spent, **Then** the briefing is written by rules from the same
   facts: the person never finds an empty home.

### User Story 3 — The assistant (P1)

1. **Given** a model configured, **When** the person asks a question, **Then** the assistant answers
   with the gateway's tools — the same as a copilot by MCP — acting as an agent on her behalf with
   her rights; it says which registers it read.
2. **Given** pay data, **Then** it is never offered to the model.

### User Story 4 — Resources (P1)

1. **Given** a person, **Then** « Resources » shows the apps, skills, MCP servers and agents her
   tier and units give her, with their owner, and her copilot's MCP address.

### User Story 5 — The use of models (P2)

1. **Given** an administrator, **Then** Administration › AI shows the model, this month's use by
   purpose, and a monthly budget past which no call is made.

## Requirements

- **FR-001**: `factsFor(person)` composes the registers (decisions, actions, surveys, meetings,
  performance, registry); `GET /v1/workspace`; the gateway's tool `my_day` returns the same.
- **FR-002**: tables of `@kete/ai` (usage, budgets) and `briefings` (person, day, text, by model or
  rules), with RLS; `GET|POST /v1/assistant/briefing`, `POST /v1/assistant/chat`,
  `GET /v1/assistant/usage`, `POST /v1/assistant/budget`.
- **FR-003**: the model from `KETE_AI_PROVIDER` and `KETE_AI_MODEL` (the key in the provider's
  usual variable); the demo uses OpenAI `gpt-6.1-sol`.
- **FR-004**: screens: Home, Assistant, Resources, Administration › AI.
- **FR-005**: the KYA demo's registry holds KYA's apps, skills and MCP servers, open to everyone.

## Out of scope

- Streaming answers; conversations kept across sessions; an agent scheduling briefings at 6 a.m.
  (the briefing is written at the first visit of the day).
