# Spec 064 — Files and pieces

Step **C4** of the plan (`docs/ROADMAP.md`), first part: a cited source opens its file at the right
place, and a thread lists its files and media once.

## Why

An answer cited the library as « Rapport de visite · p. 2 » with a link to the library's search:
the person had to find the passage again herself. And what a thread gathered — files she sent, the
documents and tables the assistant made, the records it cited — was scattered over its messages.

```mermaid
flowchart LR
  A[an answer] -->|cites| S[« Rapport de visite · p. 2 »]
  S --> D[/bibliotheque/document/id?page=2&passage=7]
  D -->|her audience opens it| R[the document, page by page · the passage marked, in view]
  D -->|not open to her| N[404]
  T[a thread] --> P[Fichiers du fil]
  P --> P1[made by the assistant · the canvas, the tables]
  P --> P2[sent by people · an image, a text, opened again]
  P --> P3[links and records cited]
```

## What changes

- **A cited passage opens at its place.** A library passage links to
  `/bibliotheque/document/<id>?page=<p>&passage=<n>`: the document as indexed, page by page, the
  cited passage marked and scrolled into view. Only for whom its source is open, a source switched
  on; an administrator reads every document. The original opens too when it came from an address.
- **A thread's files, listed once.** Beside the composer, « Fichiers du fil (n) » opens a drawer:
  what the assistant and the agents made (the canvas reopens), what people sent (an image shown with
  the previous and next ones, a text as it was read), the links and records cited.
- **A file of a conversation opens again — for its owner only**
  (`GET /v1/assistant/attachments/:id` and `/file`; the screens through `/api/pieces/:id`).
- **The demo has a library**: one after-sales report indexed without a model; search « batteries ».

## What stays for later

PDF.js for a PDF's own pages (the library keeps the text read, not the file); a spreadsheet's
sheets; the focused and canvas views of several images with comments; the review of changes for a
document as for code; versions.

## Proof

- `apps/api/tests/pieces.test.ts` (4): a search's passage links to its document with its passage, and
  the reading holds that very passage; the document is not open to whom its source is not, open to
  an administrator; a file of a conversation opens again for its owner — its text, an image's bytes —
  and for nobody else. The library tests (7) pass.
- Seen with `pnpm demo` on 2026-10-13, as Abla Nyuiadzi: « batteries autonomie » in the library
  finds the Agoè report; its link opens the document with « Passage cité » marked; after a question
  in « Demander », « Fichiers du fil (2) » lists the table the assistant made and the data set it
  cited.
