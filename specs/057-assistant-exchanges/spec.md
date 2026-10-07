# Spec 057 — Exchanges between assistants

## Why

Most questions between colleagues are small — « es-tu libre jeudi matin ? », « as-tu beaucoup en
cours ? » — and cost an interruption each. A person's assistant can now ask a colleague's. The
colleague's assistant answers alone only on what she allowed, with moments and counts; anything
else is passed to her and waits in her « À faire ». Every exchange is kept and shown to both
(doctrine D-039: an agent asks another, and it always goes back to a person).

Built on what exists: the assistant's tools (spec 027), the directory and its rights (spec 023),
« À faire » (spec 012), notifications (spec 020).

## The exchange

```mermaid
sequenceDiagram
  actor A as Awa
  participant AA as Awa's assistant
  participant X as ask (rules, no model)
  participant K as Kofi's « À faire »
  actor Ko as Kofi
  A->>AA: « Demande à Kofi s'il est libre jeudi matin »
  AA->>X: ask_colleague_assistant(Kofi, availability, question)
  X->>X: is Kofi a colleague Awa's rights let her see?
  alt Kofi allowed « Mes moments pris »
    X-->>AA: his busy moments of the next 7 days — no title
    AA-->>A: the answer, said as his assistant's
  else not allowed, or another question
    X->>K: a thing to do: « L'assistant de Awa vous demande… »
    X-->>AA: passed to him, no answer yet
    Ko->>X: answers, or does not
    X-->>A: told; the answer is in « Entre assistants »
  end
```

## Rules

- **Nothing by default**: until a person allows a subject, every question to her assistant is
  passed to her.
- **Two subjects** her assistant may answer alone:
  - _Mes moments pris_ — the moments of her dated commitments in the next 7 days, without their
    title. No calendar is connected: Kete knows only what is dated in her « À faire », and every
    answer says so.
  - _Ma charge_ — how many things wait in her « À faire », and how many are late. Never which.
- **Answered by rule, not by a model**: what her assistant says alone is computed from her data
  by fixed rules. No model reads her space on behalf of someone else.
- **Passed to her**: a thing to do in her « À faire » and a notification. She answers in her own
  words or chooses not to; the asker is told either way. The asker may take back a question that
  still waits.
- **Only colleagues she may see**: the asker reaches a person the directory shows her — herself,
  her managers and reports, or whoever her rights over the structure cover. Anyone else is as if
  unknown. A name that fits several people is refused rather than guessed.
- **Seen by both**: « Entre assistants » lists what was asked of her assistant — answered alone or
  by her — and what hers asked. A question taken back leaves the colleague's list.
- **Bounded**: at most 30 questions a day per person's assistant.
- **Never while viewing another's space**: the tool is not given, and settings, answers and
  withdrawals are refused.

## The screens

- **In the chat**: « Demande à Kofi… » calls the tool; the assistant says whether Kofi's assistant
  answered or the question was passed to him.
- **« Entre assistants »** (`/assistant/echanges`, from the assistant's page): what her assistant
  may say alone; what was asked of it, with a field to answer what waits; what it asked.

## Proof

- `tests/exchanges.test.ts`: passed to the colleague by default, in his « À faire », and he is
  told; answered by him only, the asker told; answered alone once allowed — the moment, never the
  title, and the absence of a calendar said; a subject not allowed stays passed and is taken back
  by the asker; an unknown name, herself and a colleague she cannot see are refused.
