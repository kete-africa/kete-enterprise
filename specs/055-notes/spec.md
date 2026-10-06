# Spec 055 — « Noter » and « Mon carnet »

## Why

A person at work writes things down all day — « réunion demain à 10 h avec Kofi sur l'enquête
T3 », « penser au devis ». On paper, a note stays where it was written and reminds nobody. In
Kete she writes it the same way, from any page; Kete keeps it, understands it, and puts a reminder
in her « À faire » when the note names a moment. Her assistant reads her latest notes to know what
she is busy with. The notebook is hers alone.

Built on what exists: the tasks of « À faire » (spec 012, `putTask`), `@kete/ai`'s typed
extraction with its usage journal, the organization's model (spec 014), the shell's toolbar
(spec 046), the assistant's instruction (spec 048).

## The gesture

```mermaid
sequenceDiagram
  actor P as The person
  participant W as « Noter » (any page) · « Mon carnet »
  participant A as POST /v1/notes
  participant M as The organization's model
  participant T as « À faire »
  P->>W: writes a note, as on paper
  W->>A: the text
  A->>M: a summary; a moment named? (typed extraction)
  M-->>A: summary · reminder or none
  A->>A: keeps the note in person_notes
  opt the note names a moment to come
    A->>T: a task with its due date, source « notes »
  end
  A-->>W: the note, and what was filed
  W-->>P: « Gardé dans Mon carnet. Rappel posé… » · « Annuler le rappel »
```

## Rules

- **Kept first**: a note is kept whether or not a model is configured, and when understanding
  fails. Without a model it has no summary and files nothing.
- **A reminder only for a named moment to come**: the model proposes a title and a local date and
  time; a date in the past, or one it cannot name, files nothing. No date is invented. Local time
  is Lomé's (UTC all year); other time zones are not guessed.
- **Said back, undone in one gesture**: the answer says what was filed. « Annuler le rappel »
  closes the task and keeps the note; removing a note closes its reminder too.
- **Hers alone**: the notes of a person are read and changed by her only. An administrator viewing
  her space in a demo organization sees an empty notebook, cannot write in it, and her assistant
  does not read her notes for him.
- **Read by her assistant**: her ten latest notes join the assistant's instruction, to understand
  what she is busy with — never repeated back as such.
- **Counted**: understanding a note is a use of the organization's model, recorded for her under
  the purpose `note-understanding` (spec 054 shows it).
- **Not yet**: no calendar is connected (KYA's tools are undecided), so a meeting is a reminder
  with its date in « À faire », not an event in an agenda; a note is not filed in a dossier.

## The screens

- **« Noter »** in the toolbar of every page (hidden while viewing another's space): a dialog with
  the note, then what Kete did with it.
- **« Mon carnet »** (`/carnet`, in the sidebar): the same composer, then her notes, the latest
  first, each with its reminder if it has one, « Annuler le rappel » and « Supprimer ».

## Proof

- `tests/notes.test.ts`: a note naming a moment is kept and its reminder is in « À faire » with
  its due date; a note naming none, or written without a model, files nothing; the reminder leaves
  in one gesture and the note stays; another person reads none of it and cannot remove it; an
  administrator viewing her space reads none of it and cannot write in it.
