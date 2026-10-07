# Notes (spec 055)

« Noter » and « Mon carnet »: a person writes down what she knows, as on paper. The note is kept,
understood by the organization's model, and a reminder is filed in her « À faire » when it names a
moment to come. Her assistant reads her latest notes. Hers alone.

```mermaid
flowchart LR
  P[POST /v1/notes] --> U[understand · @kete/ai extract]
  U -->|summary · reminder or none| N[(person_notes)]
  U -->|a moment to come| T[putTask · source « notes »]
  N --> L[GET /v1/notes · hers only]
  N --> A[notesPromptFor · the assistant's instruction]
  X[unfile · remove] --> C[closeTask] --> T
```

- `person_notes` is isolated by organization (RLS) and filtered by `user_id` in every query.
- A note is kept even when no model is configured or understanding fails; then nothing is filed.
- The reminder's key is the note's id: undoing or removing the note closes the same task.
- Under « view as » (demo organizations) the list is empty, writing is refused, and the assistant
  receives no notes.

## A report dictated (spec 059)

```mermaid
flowchart LR
  D[POST /v1/notes/dictate · base64 audio] --> T[platform/transcription.ts]
  T -->|text · audio not kept · counted as « dictation »| S[the screen: read back, corrected]
  S --> P[POST /v1/notes · about = the subject of her day]
  P --> N[(person_notes · about_key · about_title)]
```

- `dictate` stores nothing: the note exists once she keeps it.
- `about` ties a note to the subject it reports on (« kind:id » and its title at that moment);
  her assistant reads it as « compte rendu de … ».
