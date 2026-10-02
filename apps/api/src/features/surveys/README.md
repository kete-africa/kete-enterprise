# Surveys (spec 011)

Questionnaires, campaigns sent by personal link, answers, and results on 100 that feed the
indicators. Generic: an organization runs its own; HR and QHSE run them in their space with
`surveys:manage`, the administrators only grant the right and switch the module on.

```mermaid
stateDiagram-v2
    [*] --> draft: create-campaign
    draft --> open: open-campaign — respondents drawn from the structure, form frozen, links sent
    open --> open: remind-campaign / resend-link — a new link replaces the old one
    open --> closed: close-campaign — links revoked
    closed --> open: reopen-campaign
    closed --> published: publish-results — the scores feed the indicators (spec 012)
```

```mermaid
flowchart LR
    S[(structure at the opening date)] --> D[drawRespondents]
    D -->|about none| F1[one form each]
    D -->|about manager| F2[one form about whoever holds the position above, past vacancies]
    D -->|about reports| F3[one form per direct report]
    D -->|about a person| F4[one form about her]
    O[outside: name and e-mail] --> F1
    F1 & F2 & F3 & F4 --> R[respondent: one personal link for all her forms]
```

- **Answering**: by personal link (`/public/surveys/:token`, purpose `surveys.answer`, reference
  the respondent) or from the space (`/v1/surveys/mine`). Drafts are saved; a sent form never
  changes. The answers are never written in the journal.
- **Anonymity**: an anonymous form loses its respondent **at submission**; the respondent keeps
  only counts. Follow-up shows who answered, never what. A group with fewer answers than the
  campaign's minimum (3 by default) shows no score; free texts are listed sorted, without author.
- **Score on 100**: `(average − 1) ÷ 4 × 100` of the 1-to-5 ratings, « not applicable » left out;
  a yes/no gives its share of « yes ».
- **No e-mail**: the link of a person without an e-mail goes to whoever runs the campaign, to pass
  on by hand.
- `surveyScores(campaignId)` gives a published campaign's results to the indicators.
