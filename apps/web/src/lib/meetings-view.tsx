import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { refusal } from './forms';
import { meetingsGesture, type Action, type DecisionNote, type Meeting } from './meetings';

export function useMeetingGesture() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = (
    path: string,
    body: object,
    done?: (data: Record<string, string | number | boolean | null>) => string | undefined,
  ) => {
    setBusy(true);
    setNotice(null);
    void meetingsGesture({ data: { path, body, key: crypto.randomUUID() } })
      .then(async (answer) => {
        if (!answer.ok) return setNotice({ tone: 'error', text: refusal(answer.error) });
        const text = done?.(answer.data ?? {});
        if (text) setNotice({ tone: 'ok', text });
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };
  const view = notice ? (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`mt-3 text-body-sm ${notice.tone === 'error' ? 'text-state-error-fg' : 'text-state-success-fg'}`}
    >
      {notice.text}
    </p>
  ) : null;
  return { busy, run, notice: view };
}

export function meetingStatusLabel(status: Meeting['status']): string {
  return { planned: m.meeting_planned, held: m.meeting_held, recorded: m.meeting_recorded }[
    status
  ]();
}

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full', timeStyle: 'short' }).format(
    new Date(value),
  );

function sourceLabel(source: Action['source']): string {
  return {
    meeting: m.action_source_meeting,
    indicator: m.action_source_indicator,
    review: m.action_source_review,
    manual: m.action_source_manual,
    audit: m.action_source_audit,
  }[source]();
}

/** One action of the register, and — for its owner — the gesture that closes it. */
function ActionRow({ action, canClose }: { action: Action; canClose: boolean }) {
  const { busy, run, notice } = useMeetingGesture();
  const [note, setNote] = useState('');
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{action.title}</span>
        <Tag>{sourceLabel(action.source)}</Tag>
        {action.overdue ? (
          <Tag tone="error">{m.action_overdue({ due: action.dueOn })}</Tag>
        ) : (
          <Tag tone={action.status === 'open' ? 'info' : 'validated'}>
            {action.status === 'open' ? m.action_due_on({ due: action.dueOn }) : m.action_is_done()}
          </Tag>
        )}
        {action.responsibleName && (
          <span className="text-body-sm text-fg-muted">{action.responsibleName}</span>
        )}
      </div>
      {action.detail && (
        <p className="whitespace-pre-line text-body-sm text-fg-muted">{action.detail}</p>
      )}
      {action.doneNote && (
        <p className="text-body-sm">{m.action_done_note({ note: action.doneNote })}</p>
      )}
      {canClose && action.status === 'open' && action.source !== 'audit' && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            className="min-w-72 flex-1"
            label={m.action_what_was_done()}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            disabled={busy || !note.trim()}
            onClick={() => run(`/actions/${action.actionId}/done`, { note })}
          >
            {m.action_close()}
          </Button>
        </div>
      )}
      {notice}
    </li>
  );
}

export function ActionList({
  actions,
  personId,
  manages,
}: {
  actions: Action[];
  personId: string | null;
  manages: boolean;
}) {
  return (
    <ul>
      {actions.map((a) => (
        <ActionRow
          key={a.actionId}
          action={a}
          canClose={manages || (personId !== null && a.responsiblePersonId === personId)}
        />
      ))}
    </ul>
  );
}

/** A decision note: its number, its text, who signed, and the gesture that says « I read it ». */
export function NoteCard({ note, publishes }: { note: DecisionNote; publishes: boolean }) {
  const { busy, run, notice } = useMeetingGesture();
  const [open, setOpen] = useState(false);
  return (
    <Panel>
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <span>
          <span className="font-semibold">
            {note.number ? m.note_number({ number: note.number }) : m.note_draft()}
          </span>{' '}
          <span>{note.subject}</span>
        </span>
        <span className="flex gap-2">
          {note.status === 'published' && <Tag>{m.note_reads({ count: String(note.reads) })}</Tag>}
          {note.readByMe && <Tag tone="validated">{m.note_read()}</Tag>}
        </span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3">
          <p className="whitespace-pre-line">{note.body}</p>
          <p className="text-body-sm text-fg-muted">
            {m.note_signed({ name: note.signedByName, on: note.publishedOn ?? '—' })}
          </p>
          <div className="flex gap-2">
            {note.status === 'published' && !note.readByMe && (
              <Button
                disabled={busy}
                onClick={() => run(`/meetings/notes/${note.noteId}/read`, {})}
              >
                {m.note_mark_read()}
              </Button>
            )}
            {note.status === 'draft' && publishes && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(`/meetings/notes/${note.noteId}/publish`, {}, (d) =>
                    m.note_published({ number: String(d.number ?? '') }),
                  )
                }
              >
                {m.note_publish()}
              </Button>
            )}
          </div>
          {notice}
        </div>
      )}
    </Panel>
  );
}
