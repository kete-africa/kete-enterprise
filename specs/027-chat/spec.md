# Spec 027 — The chat of the current era

## Why

People compare the assistant with ChatGPT, Claude and Copilot from the first minute: they drop a
file, they dictate, they point at a colleague or an app, they ask for a document they can take
away. The chat does all of it, with Kete Enterprise's rights and drafts.

## Built on

- **assistant-ui** (`@assistant-ui/react`): the thread, the composer, attachments, dictation
  (`WebSpeechDictationAdapter`), mentions and commands (the trigger popover), tool views, sources —
  through its **external store runtime**, so the conversations stay Kete Enterprise's own (kept by
  its API, streamed as NDJSON). Dressed with `@kete/design`'s tokens and components.
- **unpdf** (PDF) and **mammoth** (Word) read the files on the server.

## The flow

```mermaid
sequenceDiagram
  participant P as Person
  participant W as Screens (assistant-ui)
  participant A as API
  participant M as Model
  P->>W: drops a PDF, types « @Kossi /Rédiger une note »
  W->>A: POST /v1/assistant/attachments (the file, in base64)
  A->>A: read it (unpdf, mammoth), keep it hers, under RLS
  W->>A: POST /v1/assistant/chat/stream (message, attachments' ids)
  A->>A: directives read: @person → her directory card of him; @app → only its tools; /command → its instruction
  A->>M: her words, the files' text, the images, her tools and canvas_write
  M-->>A: text, tool calls (canvas_write: the note)
  A-->>W: text · tool · canvas · source events
  W->>P: the answer, the tool cards, the drafts, the sources — the note in the canvas, beside it
```

## What a person gets

- **Files**: PDF, Word, text, CSV, Markdown, JSON, images; 10 MB at most each, 10 per message.
  Read once on the server, kept with her conversation; the model gets their text (60 000
  characters at most) or the image itself. Another person never sends a file that is not hers.
- **Mentions (@)**: the people the directory shows her (managers, reports, her units' people) — the
  assistant gets their card, as she sees it; the team's apps — only their tools answer this turn.
- **Commands (/)**: summarize, write in the canvas, as a table, explain simply, propose actions (as
  drafts to validate).
- **Dictation**: the browser's own speech recognition (French), where it exists.
- **The canvas**: a document the assistant writes beside the conversation; she edits it, copies it,
  downloads it (.md). Kept with the answer, it opens again with the conversation.
- **Sources**: the records and documents the tools returned, as links under the answer.

## Requirements

- **FR-001**: `POST /v1/assistant/attachments` reads and keeps a file, or refuses it
  (`unsupported_file`, `file_too_large`, `unreadable_file`).
- **FR-002**: the stream takes `attachments` (her own, not sent in another conversation) and
  answers with `canvas` and `source` events besides `text` and `tool`.
- **FR-003**: a message keeps its attachments, its sources and its canvas (migration 0022).
- **FR-004**: directives never reach the model as such: their labels and what they ask do.
