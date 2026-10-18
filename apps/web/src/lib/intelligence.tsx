import { CanvasIcon } from '@kete/design';
import {
  IntelligencePanel,
  useIntelligence,
  type ComposerFile,
  type PickedItem,
  type AskTransport,
  type IntelligenceHead,
  type IntelligenceWords,
} from '@kete/intelligence';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { refusal } from '@/lib/forms';
import { fetchAssistant, type DraftReview, type Payer, type StoredMessage } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { AnswerTable } from './chat/answer-table';
import { AppView } from './chat/app-view';
import { fetchViewSandbox } from './chat/views';
import { fetchMentionables, sendFeedback, uploadAttachment, type Mentionables } from './chat/api';
import type { AssistantPage } from './chat/panel';
import { rememberedPayer } from './chat/pay-with';
import { DraftCard } from './draft-card';
import { FilesPane } from './files-pane';
import { encode, fromStored, noExtras, translator, type Extras } from './intelligence-stream';
import { toolLabel } from './tool-words';

// Kete Intelligence in the center (spec 085; kete-core specs 101, 108): the drawer and the page
// « Demander » of the validated canvas, over the center's own conversations. The center's stream
// (/assistant/flux) is told as the contract `intelligence-event.v1`; what it adds beyond the
// contract — a table it read, a document written — shows after the answer's words.

/** Every word of Kete Intelligence, from the app's catalogs. */
export function intelligenceWords(): IntelligenceWords {
  return {
    name: m.intelligence_name(),
    thread: m.intelligence_thread(),
    composer: m.intelligence_composer(),
    placeholder: m.intelligence_placeholder(),
    send: m.intelligence_send(),
    stop: m.intelligence_stop(),
    hint: m.intelligence_hint(),
    context: m.intelligence_context(),
    removeContext: m.intelligence_remove_context(),
    suggestions: m.intelligence_suggestions(),
    thinking: m.intelligence_thinking(),
    reading: (tool) => m.intelligence_reading({ tool }),
    plan: m.intelligence_plan(),
    level: (level) => m.intelligence_level({ level: String(level) }),
    sources: m.intelligence_sources(),
    draft: m.intelligence_draft(),
    verify: m.intelligence_verify(),
    tally: (steps, gestures, seconds) =>
      m.intelligence_tally({
        steps: String(steps),
        gestures: String(gestures),
        seconds: String(seconds),
      }),
    seconds: (seconds) => m.intelligence_seconds({ seconds: String(seconds) }),
    stopped: m.intelligence_stopped(),
    reason: (code) => refusal(code),
    copy: m.intelligence_copy(),
    retry: m.intelligence_retry(),
    ask: m.nav_ask(),
    files: m.shell_files(),
    history: m.intelligence_history(),
    newThread: m.intelligence_new_thread(),
    wide: m.intelligence_wide(),
    close: m.common_close(),
    attach: m.intelligence_attach(),
    cite: m.intelligence_cite(),
    gestures: m.intelligence_gestures(),
    dictate: m.intelligence_dictate(),
  };
}

/** The files the center reads (spec 027). */
const accepted = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
].join(',');

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** The gestures she asks with / : the shipped skills the center knows (spec 031). */
const gestures = () => [
  { id: 'summarize', label: m.cmd_summarize(), hint: m.cmd_summarize_body() },
  { id: 'write', label: m.cmd_write(), hint: m.cmd_write_body() },
  { id: 'table', label: m.cmd_table(), hint: m.cmd_table_body() },
  { id: 'explain', label: m.cmd_explain(), hint: m.cmd_explain_body() },
  { id: 'actions', label: m.cmd_actions(), hint: m.cmd_actions_body() },
];

const encoder = new TextEncoder();
const line = (event: object) => encoder.encode(`${JSON.stringify(event)}\n`);

/**
 * The center's conversation, as Kete Intelligence reads it: one conversation per thread, its
 * answers told as the contract's events, their drafts and extras kept aside for the screen.
 */
export function useCenterIntelligence(options: {
  page: AssistantPage | null;
  payer: Payer | null;
  conversationId?: string | null;
  /** The messages of a thread opened again. */
  initial?: readonly StoredMessage[];
}) {
  const conversation = useRef<string | null>(options.conversationId ?? null);
  const [opened] = useState(() =>
    fromStored(options.initial ?? [], options.conversationId ?? null),
  );
  const page = useRef(options.page);
  page.current = options.page;
  const payer = useRef(options.payer);
  payer.current = options.payer;
  const [extras, setExtras] = useState<Extras[]>(opened.extras);
  const [drafts, setDrafts] = useState<Record<string, DraftReview>>(opened.drafts);
  const asked = useRef(opened.turns.length);
  // What goes with the next question: what she picked in it, the files she joined.
  const pending = useRef<{ picks: PickedItem[]; files: string[] }>({ picks: [], files: [] });

  const transport = useMemo<AskTransport>(
    () => async (question, _history, signal) => {
      const at = asked.current++;
      const started = Date.now();
      const { picks, files } = pending.current;
      pending.current = { picks: [], files: [] };
      setExtras((list) => {
        const next = [...list];
        next[at] = noExtras(conversation.current);
        return next;
      });
      const change = (update: (extra: Extras) => Extras) =>
        setExtras((list) => list.map((extra, index) => (index === at ? update(extra) : extra)));
      const response = await fetch('/assistant/flux', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: encode(question, picks),
          attachments: files,
          ...(conversation.current ? { conversationId: conversation.current } : {}),
          ...(payer.current ? { payer: payer.current } : {}),
          ...(page.current ? { page: page.current } : {}),
        }),
        signal,
      });
      if (!response.ok || !response.body) {
        const answer = (await response.json().catch(() => ({}))) as { error?: string };
        return new Response(line({ type: 'failed', reason: answer.error ?? 'model_failed' }));
      }
      const source = response.body.getReader();
      const decoder = new TextDecoder();
      const translate = translator(started);
      let buffer = '';
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await source.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // A line cut by the network waits for the rest of it.
          buffer = lines.pop() ?? '';
          for (const said of lines) {
            if (!said.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(said) as Record<string, unknown>;
            } catch {
              continue;
            }
            const told = translate(event);
            for (const said of told.lines) controller.enqueue(line(said));
            if (told.conversationId) conversation.current = told.conversationId;
            if (told.extra) change(told.extra);
            const draft = told.draft;
            if (draft) setDrafts((known) => ({ ...known, [draft.draftId]: draft }));
          }
        },
        cancel() {
          void source.cancel();
        },
      });
      return new Response(stream);
    },
    [],
  );
  const intelligence = useIntelligence(transport, opened.turns);
  return {
    ...intelligence,
    extras,
    drafts,
    conversationId: () => conversation.current,
    /** A question with what she picked in it and the files she joined. */
    ask: (question: string, picks: PickedItem[] = [], files: string[] = []) => {
      if (intelligence.running) return;
      pending.current = { picks, files };
      void intelligence.send(question);
    },
    /** A new thread: the next question starts a new conversation. */
    restart: () => {
      if (intelligence.running) return;
      conversation.current = null;
      asked.current = 0;
      setExtras([]);
      intelligence.clear();
    },
  };
}

/** Her opinion of an answer (spec 053): useful or not, kept once per answer. */
function Opinion({
  turnId,
  conversationId,
}: {
  turnId: string;
  conversationId: () => string | null;
}) {
  const [said, setSaid] = useState<boolean | null>(null);
  const give = (helpful: boolean) => {
    const id = conversationId();
    if (!id) return;
    setSaid(helpful);
    void sendFeedback({ data: { conversationId: id, messageId: turnId, helpful } });
  };
  const button = (helpful: boolean) => (
    <button
      type="button"
      aria-label={helpful ? m.chat_helpful() : m.chat_not_helpful()}
      title={helpful ? m.chat_helpful() : m.chat_not_helpful()}
      aria-pressed={said === helpful}
      onClick={() => give(helpful)}
      className="inline-grid size-7 place-items-center rounded-[5px] text-fg-soft hover:bg-surface-hover hover:text-fg aria-pressed:bg-surface-selected aria-pressed:text-fg"
    >
      <CanvasIcon name={helpful ? 'tup' : 'tdown'} size={16} />
    </button>
  );
  return (
    <>
      {button(true)}
      {button(false)}
    </>
  );
}

let playing: HTMLAudioElement | null = null;

/** Says an answer aloud through the instance's voice (spec 094); silent when it has none. */
async function sayAloud(text: string): Promise<HTMLAudioElement | null> {
  const response = await fetch('/assistant/voix', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language: getLocale() }),
  }).catch(() => null);
  if (!response?.ok) return null;
  playing?.pause();
  const audio = new Audio(URL.createObjectURL(await response.blob()));
  playing = audio;
  await audio.play().catch(() => undefined);
  return audio;
}

/** « Écouter »: the answer said aloud, and stopped again. */
function Listen({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'off'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = async () => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    const started = await sayAloud(text);
    if (!started) return setState('off');
    audio.current = started;
    started.onended = () => setState('idle');
    started.onpause = () => setState('idle');
    setState('playing');
  };
  const label =
    state === 'off'
      ? m.intelligence_listen_off()
      : state === 'playing'
        ? m.intelligence_listen_stop()
        : m.intelligence_listen();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={state === 'loading' || state === 'off'}
      aria-pressed={state === 'playing'}
      onClick={() => void toggle()}
      className="inline-grid size-7 place-items-center rounded-[5px] text-fg-soft hover:bg-surface-hover hover:text-fg disabled:opacity-50 aria-pressed:bg-surface-selected aria-pressed:text-fg"
    >
      <CanvasIcon name={state === 'playing' ? 'stop' : 'play'} size={16} />
    </button>
  );
}

/** What an answer brought after its words: the tables it read, the document it wrote. */
function After({
  extra,
  onCanvas,
  onSpeak,
  sandboxUrl,
}: {
  extra: Extras | undefined;
  /** Rows of a table she chose, put in the field for her to finish. */
  onSpeak: (text: string) => void;
  onCanvas?: (canvas: { title: string; content: string }) => void;
  /** Where the apps' views run (spec 030). */
  sandboxUrl: string | null;
}) {
  if (!extra || (extra.tables.length === 0 && extra.views.length === 0 && !extra.canvas)) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {sandboxUrl &&
        extra.views.map((view, index) => (
          <AppView key={index} view={view} sandboxUrl={sandboxUrl} />
        ))}
      {extra.tables.map((table, index) => (
        <AnswerTable key={index} table={table} onSpeak={onSpeak} />
      ))}
      {extra.canvas && onCanvas && (
        <button
          type="button"
          onClick={() => extra.canvas && onCanvas(extra.canvas)}
          className="inline-flex h-[26px] w-fit items-center gap-1.5 rounded-[5px] border border-line-control bg-surface-control px-[9px] text-[12px] text-fg-soft hover:border-accent hover:text-fg"
        >
          {m.intelligence_open_document({ title: extra.canvas.title })}
        </button>
      )}
      {extra.canvas && !onCanvas && extra.conversationId && (
        <a
          href={`/assistant?c=${extra.conversationId}`}
          className="inline-flex h-[26px] w-fit items-center gap-1.5 rounded-[5px] border border-line-control bg-surface-control px-[9px] text-[12px] text-fg-soft no-underline hover:border-accent hover:text-fg"
        >
          {m.intelligence_open_document({ title: extra.canvas.title })}
        </a>
      )}
    </div>
  );
}

/**
 * Kete Intelligence beside the page or as the page « Demander »: the center's conversation in the
 * validated canvas's drawer. `head` only in the drawer.
 */
export function CenterIntelligence({
  page,
  question,
  head,
  name,
  conversationId = null,
  initial,
  onConversation,
  onCanvas,
  apps = [],
  payer,
  tab = 'ask',
  onTab,
}: {
  page: AssistantPage | null;
  /** A question from Ctrl K or a page: asked as soon as it comes. */
  question?: { text: string; at: number } | null;
  head?: Omit<IntelligenceHead, 'tab' | 'onNew'> & { onNew?: () => void };
  /** Her first name, for the greeting. */
  name: string;
  conversationId?: string | null;
  /** The messages of a thread opened again. */
  initial?: readonly StoredMessage[];
  /** The conversation the thread became, once the center named it. */
  onConversation?: (conversationId: string) => void;
  /** On the page « Demander »: a document it wrote opens beside the thread. */
  onCanvas?: (canvas: { title: string; content: string }) => void;
  /** Her organization's apps she may cite with @. */
  apps?: readonly { resourceId: string; name: string }[];
  /** Who pays for the answers, when she chose (spec 026b). */
  payer?: Payer | null;
  /** In the drawer: « Demander » or « Fichiers ». */
  tab?: 'ask' | 'files';
  onTab?: (tab: 'ask' | 'files') => void;
}) {
  const [people, setPeople] = useState<Mentionables['people']>([]);
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    void fetchViewSandbox()
      .then((sandbox) => setSandboxUrl(sandbox.url))
      .catch(() => undefined);
  }, []);
  const [joined, setJoined] = useState<(ComposerFile & { attachmentId?: string })[]>([]);
  useEffect(() => {
    void fetchMentionables()
      .then((found) => setPeople(found.people))
      .catch(() => undefined);
  }, []);
  const join = (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setJoined((list) => [...list, { id, name: file.name, state: 'sending' }]);
      void toBase64(file)
        .then((data) =>
          uploadAttachment({ data: { name: file.name, contentType: file.type, data } }),
        )
        .then((answer) =>
          setJoined((list) =>
            list.map((item) =>
              item.id !== id
                ? item
                : answer.ok && answer.file
                  ? { ...item, state: 'ready', attachmentId: answer.file.attachmentId }
                  : { ...item, state: 'failed' },
            ),
          ),
        )
        .catch(() =>
          setJoined((list) =>
            list.map((item) => (item.id === id ? { ...item, state: 'failed' } : item)),
          ),
        );
    }
  };
  const [state, setState] = useState<{
    available: boolean;
    payers: Payer[];
    readAloud: boolean;
  } | null>(null);
  const [withPage, setWithPage] = useState(true);
  useEffect(() => {
    if (state) return;
    void fetchAssistant()
      .then((a) => setState({ available: a.available, payers: a.payers, readAloud: a.readAloud }))
      .catch(() => setState({ available: false, payers: [], readAloud: false }));
  }, [state]);
  const shown = withPage ? page : null;
  const center = useCenterIntelligence({
    page: shown,
    payer: payer !== undefined ? payer : state ? rememberedPayer(state.payers) : null,
    conversationId,
    ...(initial ? { initial } : {}),
  });
  const asked = useRef<number | null>(null);
  useEffect(() => {
    if (!question || !state?.available || asked.current === question.at) return;
    asked.current = question.at;
    center.ask(question.text);
  }, [question, state, center]);
  // Her answers read aloud as they finish, when she chose so (spec 094, `kete.spoken_answers`).
  const read = useRef<string | null>(null);
  const last = center.turns.at(-1);
  useEffect(() => {
    if (!state?.readAloud || !last || last.state !== 'done' || !last.text) return;
    if (read.current === last.id) return;
    read.current = last.id;
    void sayAloud(last.text);
  }, [state, last]);
  const named = center.extras.at(-1)?.conversationId;
  // Said once its answer is over: a page that writes it in its address reloads, and must not cut
  // the answer as it streams.
  const answering = center.running;
  useEffect(() => {
    if (named && !answering) onConversation?.(named);
  }, [named, answering, onConversation]);
  useEffect(() => setWithPage(true), [page?.href]);

  const words = intelligenceWords();
  const intro: ReactNode =
    state && !state.available ? (
      <p className="m-0">{m.assistant_unavailable()}</p>
    ) : (
      <p className="m-0">
        {m.intelligence_intro_a({ name })} <b>{m.intelligence_intro_b()}</b>
        {m.intelligence_intro_c()}
      </p>
    );
  return (
    <IntelligencePanel
      turns={center.turns}
      running={center.running}
      onSend={(text, picks) => {
        const ready = joined.flatMap((file) =>
          file.state === 'ready' && file.attachmentId ? [file.attachmentId] : [],
        );
        center.ask(text, picks, ready);
        setJoined([]);
      }}
      composer={{
        attach: {
          accept: accepted,
          files: joined,
          onFiles: join,
          onRemove: (id) => setJoined((list) => list.filter((file) => file.id !== id)),
        },
        mentions: [
          ...people.map((person) => ({
            id: `person:${person.userId}`,
            label: person.name,
            ...(person.detail ? { hint: person.detail } : {}),
          })),
          ...apps.map((app) => ({
            id: `app:${app.resourceId}`,
            label: app.name,
            hint: m.chat_category_apps(),
          })),
        ],
        gestures: gestures(),
        dictate: { lang: getLocale() === 'en' ? 'en-US' : 'fr-FR' },
        ...(prefill ? { prefill } : {}),
      }}
      onStop={center.stop}
      words={words}
      {...(head
        ? {
            head: {
              ...head,
              tab,
              ...(onTab ? { onTab } : {}),
              onNew: () => {
                center.restart();
                head.onNew?.();
              },
            },
          }
        : {})}
      {...(page && withPage
        ? { context: { label: page.title, onRemove: () => setWithPage(false) } }
        : {})}
      files={
        <FilesPane
          accept={accepted}
          onFiles={(files) => {
            join(files);
            onTab?.('ask');
          }}
        />
      }
      scope={{
        value: 'everywhere',
        label: m.intelligence_scope(),
        options: [{ value: 'everywhere', label: m.intelligence_scope_everywhere() }],
        onChange: () => undefined,
      }}
      intro={intro}
      suggestions={
        state?.available
          ? [
              // On the page « Demander » itself, there is no other page to explain.
              ...(shown && shown.href !== '/assistant'
                ? [m.panel_explain_page(), m.panel_next_step()]
                : []),
              m.intelligence_suggest_week(),
            ]
          : []
      }
      toolLabel={toolLabel}
      renderDraft={(draft) => {
        const known = center.drafts[draft.id];
        return known ? <DraftCard draft={known} inChat /> : null;
      }}
      renderAfter={(_turn, index) => (
        <After
          extra={center.extras[index]}
          sandboxUrl={sandboxUrl}
          onSpeak={(text) => setPrefill({ text, at: Date.now() })}
          {...(onCanvas ? { onCanvas } : {})}
        />
      )}
      onRetry={(turn) => center.ask(turn.question)}
      answerActions={(turn) =>
        turn.text ? (
          <>
            <button
              type="button"
              onClick={() => center.ask(m.panel_pin_ask())}
              className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-line-control bg-surface-control px-2.5 text-[13px] font-semibold text-fg hover:bg-surface-hover"
            >
              <CanvasIcon name="pin" size={14} />
              {m.intelligence_pin()}
            </button>
            <Listen text={turn.text} />
            <Opinion turnId={turn.id} conversationId={center.conversationId} />
          </>
        ) : null
      }
    />
  );
}
