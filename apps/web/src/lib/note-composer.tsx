import { Button } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { unfileNote, writeNote, type Note } from './notes';

/**
 * « Noter » (spec 055): she writes as on paper; the note is kept in her notebook, a reminder
 * filed in « À faire » when it names a moment — said back to her, undone in one gesture.
 */
export function NoteComposer({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const when = (value: string) =>
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full', timeStyle: 'short' }).format(
      new Date(value),
    );
  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
        {m.notebook_write()}
        <textarea
          value={text}
          rows={3}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          placeholder={m.notebook_placeholder()}
          className="rounded-control border border-line-control bg-surface-control px-3 py-2 font-normal"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !text.trim()}
          onClick={() => {
            setBusy(true);
            setError(null);
            void writeNote({ data: { text } })
              .then(async (answer) => {
                if (!answer.ok || !answer.note) return setError(refusal(answer.error));
                setKept(answer.note);
                setText('');
                await router.invalidate();
              })
              .catch(() => setError(m.error_generic()))
              .finally(() => setBusy(false));
          }}
        >
          {m.notebook_keep()}
        </Button>
        {onDone && (
          <Button variant="secondary" onClick={onDone}>
            {m.common_close()}
          </Button>
        )}
      </div>
      {kept && (
        <div
          role="status"
          className="grid gap-1 rounded-box border border-line bg-surface-muted p-3"
        >
          <p className="font-semibold">{m.notebook_kept()}</p>
          {kept.reminder ? (
            <div className="flex flex-wrap items-center gap-2 text-body-sm">
              <span>
                {m.notebook_reminder_filed({
                  title: kept.reminder.title,
                  at: when(kept.reminder.at),
                })}
              </span>
              <button
                type="button"
                className="font-semibold underline underline-offset-4"
                onClick={() =>
                  void unfileNote({ data: { noteId: kept.noteId } }).then(async () => {
                    setKept({ ...kept, reminder: null });
                    await router.invalidate();
                  })
                }
              >
                {m.notebook_unfile()}
              </button>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">{m.notebook_nothing_filed()}</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
