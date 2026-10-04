# Spec 028 — The company's library

## Why

« What does our procedure say about a customer complaint? » The assistant answers from the
company's own documents, cites the document and the page, and never shows a person what she may
not read. Built on `@kete/knowledge` (kete-core spec 052): pgvector, Postgres full text, the
recursive splitter of LangChain, the AI SDK's embeddings, and the file reading the chat already
uses (unpdf, mammoth).

## The flow

```mermaid
sequenceDiagram
  participant A as Administrator
  participant P as Person
  participant E as Kete Enterprise
  participant K as @kete/knowledge
  A->>E: Administration › Modules: the library on
  A->>E: a source « Procédures qualité », open to everyone · « Rapports SAV », open to the SAV
  A->>E: a document (PDF, Word, text)
  E->>E: read page by page (unpdf, mammoth)
  E->>K: indexDocument — passages, embeddings, with row-level security
  P->>E: Bibliothèque, or the assistant's tool knowledge_search
  E->>E: her keys: everyone, herself, her units and those above them, administrators
  E->>K: search — enabled sources whose audience meets her keys
  K-->>P: passages with their document, page and source; the assistant cites them
```

## Rules

- **Who reads what**: a source is open to everyone, to units (a document open to the SAV is read by
  its teams below it, never by units above or beside it), to administrators, or to named people.
- **Switched off**: a source switched off is read by nobody; its documents stay indexed until it is
  switched on again.
- **Administrators** add sources, documents, and set each source's audience; never while viewing a
  demo person's space.
- **Cited**: every passage carries its document's title, its page when it has pages, its source.
- **Module**: the library is a module (Administration › Modules), off until switched on.
- **Model**: the embedding model is configuration (`KETE_EMBEDDING_PROVIDER`, `KETE_EMBEDDING_MODEL`,
  else the organization's provider); its use is journaled (`knowledge`).

## Requirements

- **FR-001**: `GET /v1/knowledge/sources` (all for administrators, those she may read otherwise),
  `POST /v1/knowledge/sources`, `/sources/:id`, `/sources/:id/remove`.
- **FR-002**: `GET|POST /v1/knowledge/sources/:id/documents`, `POST /v1/knowledge/documents/:id/remove`;
  20 MB at most; PDF, Word, text, CSV, Markdown, JSON.
- **FR-003**: `GET /v1/knowledge/search?q=` in what she may read; the chat's tool
  `knowledge_search` (level 1), whose passages become the answer's sources.
- **FR-004**: migration `0026_knowledge` (pgvector, row-level security); module `knowledge`.
- **FR-005**: screens « Bibliothèque » and « Administration › Bibliothèque ».

## Next

Connectors (SharePoint, Google Drive) as other kinds of sources; Docling for scanned documents.

## Proof

« Que dit notre procédure sur une réclamation client ? » — the answer cites « Procédure NC v3 »,
and a technician of another unit never sees the SAV's reports.
