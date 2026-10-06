import { PageHeader, Panel, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { NoteComposer } from '@/lib/note-composer';
import { fetchNotes, removeNote, unfileNote } from '@/lib/notes';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/carnet')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchNotes(),
  component: NotebookPage,
});

const actionClass =
  'rounded-control px-2 py-1 text-body-sm font-semibold text-fg hover:bg-surface-hover';

/** « Mon carnet » (spec 055): what she wrote down, newest first; private, read by her assistant. */
function NotebookPage() {
  const { me } = Route.useRouteContext();
  const { notes } = Route.useLoaderData();
  const router = useRouter();
  const when = (value: string, full = false) =>
    new Intl.DateTimeFormat(getLocale(), {
      dateStyle: full ? 'full' : 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <AppShell me={me} current="notebook">
      <PageHeader title={m.notebook_title()} description={m.notebook_explain()} />
      {!me.viewedBy && (
        <Panel>
          <NoteComposer />
        </Panel>
      )}
      {me.viewedBy ? (
        <p className="text-fg-muted">{m.notebook_private()}</p>
      ) : notes.length === 0 ? (
        <p className="text-fg-muted">{m.notebook_none()}</p>
      ) : (
        <ul className="grid rounded-box border border-line">
          {notes.map((note) => (
            <li
              key={note.noteId}
              className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className="text-body-sm text-fg-muted">{when(note.createdAt)}</span>
              <p className="whitespace-pre-wrap">{note.text}</p>
              <div className="flex flex-wrap items-center gap-2">
                {note.reminder && (
                  <Tag tone="info">
                    {m.notebook_reminder({
                      title: note.reminder.title,
                      at: when(note.reminder.at, true),
                    })}
                  </Tag>
                )}
                {!me.viewedBy && note.reminder && (
                  <button
                    type="button"
                    className={actionClass}
                    onClick={() =>
                      void unfileNote({ data: { noteId: note.noteId } }).then(() =>
                        router.invalidate(),
                      )
                    }
                  >
                    {m.notebook_unfile()}
                  </button>
                )}
                {!me.viewedBy && (
                  <button
                    type="button"
                    className={actionClass}
                    onClick={() =>
                      void removeNote({ data: { noteId: note.noteId } }).then(() =>
                        router.invalidate(),
                      )
                    }
                  >
                    {m.notebook_remove()}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
