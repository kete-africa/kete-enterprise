# Spec 038 — Documents

## Why

« Send Mrs Owusu the intervention letter, in our format. » An organization produces its documents
with its own templates — letters, quotes, certificates — and its layout and logo. An administrator
uploads the Word template once; any person, or the assistant for her, fills it into a final .docx
or a PDF ready to send; the canvas the assistant wrote becomes a PDF too. What she produces is
hers alone. And every file the organization keeps is read, whatever its kind: Word, Excel,
PowerPoint, OpenDocument, and scans, read by the organization's model. Built on `@kete/files`
(kete-core spec 053: officeparser, docxtemplater, Gotenberg) and `@kete/ai`'s `scanReader`.

## The flow

```mermaid
sequenceDiagram
  participant A as Administrator
  participant P as Person
  participant AI as Assistant
  participant E as Kete Enterprise
  participant F as @kete/files
  participant G as Gotenberg (optional)
  A->>E: POST /v1/documents/templates (.docx)
  E->>F: templateFields — {client}, {date}
  P->>AI: « Prépare le courrier d'intervention pour Mme Owusu, en PDF »
  AI->>E: document_templates · document_fill (level 1)
  E->>F: fillTemplate(values)
  E->>G: fromWord (only when KETE_GOTENBERG_URL is set; 409 otherwise)
  E-->>AI: her document's link
  AI-->>P: « Votre courrier est prêt » · /api/documents/gdoc_…
  P->>E: GET /v1/documents/:id (hers only)
  P->>E: canvas › Exporter en PDF → POST /v1/documents/pdf
```

## Rules

- **Templates are set by administrators** (never while viewing another person's space); a file
  that is not a Word template is refused (`template_invalid`). A switched-off template is not
  offered nor filled.
- **What she produces is hers**: kept with her, readable and removable by her only; never while an
  administrator views her space.
- **PDF only with a conversion configured** (`KETE_GOTENBERG_URL`): otherwise 409 `pdf_unavailable`
  and the screens offer Word only.
- **The assistant's tools are level 1**: they produce a file for her, change nothing elsewhere.
- **Reading**: `platform/extract.ts` is `@kete/files`' `readDocument`; the library and the dossiers
  give scans to the organization's model (purpose `reading`, metered); the chat keeps an image as
  an image for the model.
- **Off by default**: the `documents` module. Words from the catalogs (French, English).

## Data

| Table                 | Holds                                                         |
| --------------------- | ------------------------------------------------------------- |
| `document_templates`  | name, description, fields, the .docx, on/off, who added it    |
| `generated_documents` | whose, from which template, name, type, content (20 MB at most) |

Both carry the organization's row-level security policy, in the migration `0030_documents`.

## Interface

- **Documents** (`/documents`): the templates, each filled in a dialog (Word, or PDF when
  configured); her documents, downloaded or removed.
- **Administration › Modèles de documents** (`/administration/modeles`): add, switch off or on,
  remove.
- **The assistant's canvas**: « Exporter en PDF », when the module is on.
- Uploads accept Word, Excel, PowerPoint, OpenDocument and RTF.

## Proof

`apps/api/tests/documents.test.ts`: the module gate; templates by administrators with their fields;
a .docx filled for her and unreadable by another; PDF refused without a converter, produced with
one; the canvas as PDF; the assistant's tools; a switched-off template; a scan read by the model
and found in the library.
