# Spec 071 — Twelve scenarios

Step **C11** of the plan (`docs/ROADMAP.md`): twelve things a person does in a working day, played
in Kete Enterprise, each scored, with the gaps listed —
[`docs/design/scenarios-2026-10.md`](../../docs/design/scenarios-2026-10.md).

## What was done

- Twelve scenarios were chosen from the plan's own steps: her morning, a question on figures, a
  question on a document, work asked of a colleague, an agent steered, an agent from a sentence, a
  draft decided with « Comment ? », a rule that refuses, the ERP's requests, the phone's messaging,
  the field, and what it remembers and lets out.
- Each was played in Kete Enterprise with `pnpm demo` on 2026-10-13 and scored on a scale of 0 to
  3, with what was seen, what is proven by tests only, and what is missing.
- Kete Enterprise scores **18 out of 36**. The demo has no model and no ERP — answers and data are
  written in advance — so no scenario can reach 3.

## What was not done

**ChatGPT and Claude were not played.** The roadmap asks for the scenarios side by side with both.
It was done without an account on either product, and a scripted demo cannot be compared with them
on the quality of answers. The document leaves their columns empty and says what to look at, for a
person to play. It makes no claim about what they can do.

## Proof

- The list of gaps, scenario by scenario, and « in the order they hurt », in the document.
- Not proven: the comparison. It needs a person, the two products, and Kete Enterprise on a real
  model.
