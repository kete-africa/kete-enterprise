import { Button, Panel, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal, Select } from '@/lib/forms';
import { prepareRecord, recordMeeting, sendTranscript, type RecordProposal } from '@/lib/meetings';
import * as m from '@/paraglide/messages.js';

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * A meeting's record prepared from what was said (spec 035): its recording or transcript, the
 * record and decisions the assistant proposes, corrected here, then recorded and published by the
 * person who runs the meeting.
 */
export function RecordAssistant({
  meetingId,
  present,
  initial,
}: {
  meetingId: string;
  present: { personId: string; name: string }[];
  initial: { source: 'audio' | 'text'; proposal: RecordProposal | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'audio' | 'text' | null>(initial?.source ?? null);
  const [text, setText] = useState('');
  const [proposal, setProposal] = useState<RecordProposal | null>(initial?.proposal ?? null);
  const [done, setDone] = useState<string | null>(null);
  const run = async <T,>(
    work: () => Promise<{ ok: boolean; error: string | null; data: T | null }>,
    then: (data: T) => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const answer = await work();
      if (!answer.ok || answer.data === null) setError(refusal(answer.error));
      else then(answer.data);
    } catch {
      setError(m.error_generic());
    } finally {
      setBusy(false);
    }
  };
  const decisions = proposal?.decisions ?? [];
  const change = (index: number, patch: Partial<RecordProposal['decisions'][number]>) =>
    proposal &&
    setProposal({
      ...proposal,
      decisions: decisions.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    });
  return (
    <Panel>
      <div className="grid gap-4">
        <p className="text-body-sm text-fg-muted">{m.record_assist_explain()}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label
            htmlFor={`audio-${meetingId}`}
            className="inline-flex h-(--control-height) cursor-pointer items-center rounded-control border border-line-control px-(--control-padding) font-semibold hover:bg-surface-hover"
          >
            {m.record_assist_audio()}
          </label>
          <input
            id={`audio-${meetingId}`}
            type="file"
            hidden
            accept="audio/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void run(
                async () =>
                  sendTranscript({
                    data: {
                      meetingId,
                      audio: await toBase64(file),
                      contentType: file.type || 'audio/webm',
                    },
                  }),
                (data) => {
                  setSource(data.transcript.source);
                  setProposal(null);
                },
              );
            }}
          />
        </div>
        <label className="grid gap-1.5 text-body-sm font-semibold">
          {m.record_assist_text()}
          <textarea
            className="min-h-32 rounded-control border border-line-control bg-surface-control p-3 font-normal"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy || !text.trim()}
            onClick={() =>
              void run(
                () => sendTranscript({ data: { meetingId, text } }),
                (data) => {
                  setSource(data.transcript.source);
                  setProposal(null);
                },
              )
            }
          >
            {m.record_assist_save_text()}
          </Button>
          <Button
            disabled={busy || !source}
            onClick={() =>
              void run(
                () => prepareRecord({ data: { meetingId } }),
                (data) => setProposal(data.proposal),
              )
            }
          >
            {m.record_assist_prepare()}
          </Button>
        </div>
        {source && !proposal && (
          <p role="status" className="text-body-sm">
            {m.record_assist_transcribed({ source })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-state-error-fg">
            {error}
          </p>
        )}
        {proposal && (
          <div className="grid gap-3 border-t border-line pt-3">
            <h3 className="font-heading font-semibold">{m.record_assist_proposal()}</h3>
            <label className="grid gap-1.5 text-body-sm font-semibold">
              {m.meeting_record_notes()}
              <textarea
                className="min-h-48 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                value={proposal.notes}
                onChange={(e) => setProposal({ ...proposal, notes: e.target.value })}
              />
            </label>
            <h4 className="font-semibold">{m.record_assist_decisions()}</h4>
            <ul className="grid gap-3">
              {decisions.map((d, index) => (
                <li key={index} className="grid gap-2 rounded-box border border-line p-3">
                  <TextField
                    label={m.decision_text()}
                    value={d.text}
                    onChange={(e) => change(index, { text: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Select
                      label={m.decision_owner_field()}
                      value={d.responsiblePersonId ?? ''}
                      onChange={(e) =>
                        change(index, { responsiblePersonId: e.target.value || null })
                      }
                    >
                      <option value="">{m.field_nobody()}</option>
                      {present.map((p) => (
                        <option key={p.personId} value={p.personId}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    <TextField
                      label={m.decision_due()}
                      type="date"
                      value={d.dueOn ?? ''}
                      onChange={(e) => change(index, { dueOn: e.target.value || null })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-body-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={d.idea}
                        onChange={(e) => change(index, { idea: e.target.checked })}
                      />
                      {m.decision_is_idea()}
                    </label>
                    <button
                      type="button"
                      className="font-semibold text-link underline"
                      onClick={() =>
                        setProposal({
                          ...proposal,
                          decisions: decisions.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {m.record_assist_remove()}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => recordMeeting({ data: { meetingId, notes: proposal.notes, decisions } }),
                    (data) => {
                      setDone(m.record_assist_done({ count: data.decisions.length }));
                      void router.invalidate();
                    },
                  )
                }
              >
                {m.record_assist_publish()}
              </Button>
            </div>
          </div>
        )}
        {done && (
          <p role="status" className="font-semibold">
            {done}
          </p>
        )}
      </div>
    </Panel>
  );
}
