import { Icon } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { refusal } from '@/lib/forms';
import * as m from '@/paraglide/messages.js';
import { dictateNote, writeNote, type Note } from './notes';

// « Dicter un compte rendu » (spec 059): she speaks, reads what was understood, corrects it and
// keeps it — in her notebook, tied to the subject it reports on. The recording is read once by
// the API and never kept. Large targets: it is used on a phone, one hand free.

/** The longest recording: a report, not a meeting. */
const MAX_SECONDS = 300;

const big =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control px-5 text-[18px] font-semibold disabled:opacity-60';
const primary = `${big} bg-action text-on-action hover:bg-action-strong`;
const secondary = `${big} border border-line-control text-fg hover:bg-surface-hover`;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
    reader.readAsDataURL(blob);
  });

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

type Phase = 'idle' | 'recording' | 'reading' | 'review' | 'kept';

export function Dictation({ about }: { about: { key: string; title: string } | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState<Note | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const stop = () => {
    if (recorder.current?.state === 'recording') {
      setPhase('reading');
      recorder.current.stop();
    }
  };
  useEffect(() => {
    if (phase !== 'recording') return;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [phase]);
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) stop();
  }, [phase, seconds]);
  // Leaving the page releases the microphone.
  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const read = async (blob: Blob) => {
    try {
      const answer = await dictateNote({
        data: { audio: await toBase64(blob), contentType: blob.type || 'audio/webm' },
      });
      if (answer.ok) setText((before) => (before ? `${before}\n${answer.text}` : answer.text));
      else setError(refusal(answer.error));
    } catch {
      setError(m.error_generic());
    }
    setPhase('review');
  };

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(m.dictation_unsupported());
      setPhase('review');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(stream);
      chunks.current = [];
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      next.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void read(new Blob(chunks.current, { type: next.mimeType || 'audio/webm' }));
      };
      recorder.current = next;
      setSeconds(0);
      next.start();
      setPhase('recording');
    } catch {
      setError(m.dictation_no_microphone());
      setPhase('review');
    }
  };

  const keep = () => {
    setPhase('reading');
    setError(null);
    void writeNote({ data: { text, ...(about ? { about } : {}) } })
      .then(async (answer) => {
        if (!answer.ok || !answer.note) {
          setError(refusal(answer.error));
          return setPhase('review');
        }
        setKept(answer.note);
        setText('');
        setPhase('kept');
        await router.invalidate();
      })
      .catch(() => {
        setError(m.error_generic());
        setPhase('review');
      });
  };

  return (
    <div className="grid gap-3">
      {about && phase !== 'kept' && (
        <p className="text-fg-muted">{m.dictation_about({ title: about.title })}</p>
      )}
      {phase === 'idle' && (
        <button type="button" className={primary} onClick={() => void start()}>
          <Icon name="mic" size={22} />
          {m.dictation_start()}
        </button>
      )}
      {phase === 'recording' && (
        <>
          <p role="status" className="text-[18px] font-semibold">
            {m.dictation_listening({ time: clock(seconds) })}
          </p>
          <button type="button" className={primary} onClick={stop}>
            <Icon name="stop" size={22} />
            {m.dictation_stop()}
          </button>
        </>
      )}
      {phase === 'reading' && (
        <p role="status" className="text-[18px] font-semibold">
          {m.dictation_reading()}
        </p>
      )}
      {phase === 'review' && (
        <>
          <label className="grid gap-1.5 font-semibold">
            {m.dictation_review()}
            <textarea
              rows={6}
              maxLength={4000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="rounded-control border border-line-control bg-surface-control px-3 py-3 text-[18px] font-normal"
            />
          </label>
          <button type="button" className={primary} disabled={!text.trim()} onClick={keep}>
            {m.dictation_keep()}
          </button>
          <button type="button" className={secondary} onClick={() => void start()}>
            <Icon name="mic" size={22} />
            {text.trim() ? m.dictation_more() : m.dictation_again()}
          </button>
        </>
      )}
      {phase === 'kept' && kept && (
        <div role="status" className="grid gap-3 rounded-box border border-line bg-surface p-4">
          <p className="text-[18px] font-semibold">{m.dictation_kept()}</p>
          <p className="text-fg-muted">{m.dictation_kept_explain()}</p>
          <a className={secondary} href="/carnet">
            {m.dictation_open_notebook()}
          </a>
          <button type="button" className={secondary} onClick={() => setPhase('idle')}>
            <Icon name="mic" size={22} />
            {m.dictation_another()}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
