# Spec 026b — « Pay with »: the organization, her key, or her own subscription

## Why

Spec 026 lets a person bring her own API key. Many people already pay for a subscription to an AI
assistant, and would rather use it at work than buy tokens again. In the chat, each person chooses
who pays for her answers — among what her organization allows.

## The flow

```mermaid
sequenceDiagram
  participant P as Person
  participant E as Kete Enterprise
  participant M as Her own machine (sandbox)
  participant S as Her subscription's provider
  P->>E: Ma connexion IA › « Connecter mon abonnement »
  E->>M: create her machine (nothing of Kete's account in it), or resume hers
  E->>M: start the agent's device sign-in
  M-->>E: the sign-in page and a one-time code (15 minutes)
  E-->>P: the page to open, the code to enter
  P->>S: signs in to her account, enters the code
  S-->>M: her sign-in, kept on her machine only
  P->>E: « J'ai terminé »
  E->>M: is she signed in?
  M-->>E: yes — her machine rests (kept, not billed)
  P->>E: in the chat, « Payer avec : Mon abonnement », her message
  E->>E: does the policy let her subscription pay?
  E->>M: resume her machine; the prompt (read-only, no tool, no network for commands)
  M->>S: the agent asks her subscription
  M-->>E: the answer
  E-->>P: the answer, kept in the conversation; journaled « chat:subscription », no token counted
```

## Rules

- **Who may pay**, by the organization's policy (spec 026): `off` — the organization only;
  `allowed` — the organization, her key, her subscription; `required` — hers only. « Payer avec »
  under the composer shows only those, when there is a choice; her last choice is remembered on her
  device. Without a choice: her key, else the organization, else her subscription.
- **Her machine is hers**: created without any of Kete's environment or secrets; her sign-in stays
  on it, never in Kete Enterprise, which keeps only which machine is hers and whether she finished
  signing in. Removing her subscription deletes her machine, and her sign-in with it.
- **Read-only**: her subscription's agent answers from what she sends — her message, the
  conversation, her files' text and images — without Kete Enterprise's tools nor apps; it writes
  nothing and its commands reach no network, whatever a file asks.
- **Who pays shows**: each answer of her subscription is journaled as `chat:subscription`, one call,
  no token counted against the organization's budget.
- **Herself only**: an administrator viewing her space never connects nor removes it.
- **Signed out**: when her subscription no longer answers, the chat says so and sends her to « Ma
  connexion IA » to connect it again.

## Requirements

- **FR-001**: `GET /v1/ai/connection` adds `subscriptionsAvailable` and her `subscription`
  (state, dates) — never her machine.
- **FR-002**: `POST /v1/ai/subscription` starts her sign-in (refused when the policy is `off`, or
  the instance runs no machine) and answers the page and the code; `POST
  /v1/ai/subscription/check` says whether she is signed in; `POST /v1/ai/subscription/remove`
  deletes her machine.
- **FR-003**: `GET /v1/assistant` gives `payers`, the first by default; `POST
  /v1/assistant/chat/stream` takes `payer`, refused (`payer_refused`) when the policy does not let
  it pay.
- **FR-004**: table `ai_subscriptions` with its row-level security in migration
  `0023_ai_subscriptions`.

## Configuration

- `KETE_SANDBOX_API_KEY`: the machines' provider (without it, subscriptions are not offered).
- `KETE_SUBSCRIPTION_MODEL`: the model her subscription answers with (default `gpt-6.1-sol`).

## Proof

Kofi connects his own subscription, chooses « Mon abonnement » in the chat, and his question is
answered on it; the organization's budget is untouched.
