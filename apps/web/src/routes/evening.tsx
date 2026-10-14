import {
  Button,
  PageHeader,
  PageSection,
  ProposalList,
  TextAreaField,
  VoiceCapture,
  type ProposalWords,
} from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { closeMyDay, decideMyEvening, type EveningSet } from '@/lib/closure';
import { refusal } from '@/lib/forms';
import { dictateNote } from '@/lib/notes';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/soir')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  component: EveningPage,
});

const words = (): ProposalWords => ({
  label: m.evening_proposals(),
  apply: (count) => m.evening_apply({ count: String(count) }),
  dismiss: m.evening_dismiss(),
  undo: m.evening_undo(),
  level: (level) =>
    level <= 2 ? m.evening_level_reversible() : m.evening_level({ level: String(level) }),
  outcomes: {
    applied: m.evening_outcome_applied(),
    failed: m.evening_outcome_failed(),
    needs_confirmation: m.evening_outcome_confirm(),
    not_ticked: m.evening_outcome_left(),
    undone: m.evening_outcome_undone(),
    undo_failed: m.evening_outcome_undo_failed(),
  },
});

async function base64Of(audio: Blob): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * « Ce soir » (spec 083, doctrine D-051): she writes or says what her day was; the assistant
 * proposes gestures on her To do — close, move, a reminder — which she ticks, applies together,
 * and may undo together. Nothing changes before her gesture.
 */
function EveningPage() {
  const { me } = Route.useRouteContext();
  const [note, setNote] = useState('');
  const [set, setSet] = useState<EveningSet | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = (next: EveningSet) => {
    setSet(next);
    setTicked(next.items.filter((item) => item.ticked).map((item) => item.key));
  };
  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch {
      setSaid(m.error_generic());
    } finally {
      setBusy(false);
    }
  }
  const decide = (gesture: 'apply' | 'dismiss' | 'undo') =>
    void run(async () => {
      if (!set) return;
      const answer = await decideMyEvening({ data: { id: set.id, gesture, ticked } });
      if (answer.ok) show(answer.set);
      else setSaid(refusal(answer.error));
    });

  return (
    <AppShell me={me} current="home">
      <PageHeader title={m.evening_title()} description={m.evening_explain()} />
      <PageSection first>
        <div className="flex max-w-2xl flex-col gap-4">
          <TextAreaField
            label={m.evening_note_label()}
            hint={m.evening_note_hint()}
            value={note}
            rows={5}
            maxLength={4000}
            onChange={setNote}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || !note.trim() || Boolean(me.viewedBy)}
              onClick={() =>
                void run(async () => {
                  setSaid(null);
                  const answer = await closeMyDay({ data: { text: note } });
                  if (!answer.ok) return setSaid(refusal(answer.error));
                  if (answer.unclear.length) {
                    setSaid(m.evening_unclear({ parts: answer.unclear.join(' · ') }));
                  }
                  if (answer.set) show(answer.set);
                  else if (!answer.unclear.length) setSaid(m.evening_nothing());
                })
              }
            >
              {m.evening_understand()}
            </Button>
            <VoiceCapture
              disabled={busy || Boolean(me.viewedBy)}
              words={{
                start: m.evening_voice_start(),
                stop: m.evening_voice_stop(),
                recording: (seconds) => m.evening_voice_recording({ seconds: String(seconds) }),
                unavailable: m.evening_voice_unavailable(),
              }}
              onAudio={(audio) =>
                void run(async () => {
                  const heard = await dictateNote({
                    data: { audio: await base64Of(audio), contentType: audio.type || 'audio/webm' },
                  });
                  if (heard.ok) setNote((before) => `${before} ${heard.text}`.trim());
                  else setSaid(refusal(heard.error));
                })
              }
            />
          </div>
          {said && (
            <p role="status" className="text-body-sm text-fg-muted">
              {said}
            </p>
          )}
        </div>
      </PageSection>
      {set && (
        <PageSection title={m.evening_proposals()}>
          <div className="max-w-2xl">
            <ProposalList
              busy={busy}
              status={set.status}
              words={words()}
              rows={set.items.map((item) => ({
                key: item.key,
                label: item.label,
                ...(item.reason ? { reason: item.reason } : {}),
                level: item.level,
                ticked: set.status === 'proposed' ? ticked.includes(item.key) : item.ticked,
                ...(set.outcomes[item.key] ? { outcome: set.outcomes[item.key] } : {}),
              }))}
              onToggle={(key) =>
                setTicked((list) =>
                  list.includes(key) ? list.filter((k) => k !== key) : [...list, key],
                )
              }
              onApply={() => decide('apply')}
              onDismiss={() => decide('dismiss')}
              onUndo={() => decide('undo')}
            />
          </div>
        </PageSection>
      )}
    </AppShell>
  );
}
