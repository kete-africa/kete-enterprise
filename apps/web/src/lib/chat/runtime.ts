import {
  createMessageQueue,
  useExternalStoreRuntime,
  WebSpeechDictationAdapter,
  type AppendMessage,
  type AttachmentAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AnswerTable, AppView, DraftReview, Payer, StoredMessage } from '@/lib/workspace';
import { sendFeedback, uploadAttachment } from './api';

// The chat's runtime (spec 027), on assistant-ui's external store: the conversations stay Kete
// Enterprise's own — kept by its API, streamed as NDJSON — and assistant-ui draws them, attaches
// files, dictates, picks mentions and commands.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: { name: string; state: 'running' | 'done' | 'refused' }[];
  drafts: DraftReview[];
  attachments: { attachmentId: string; name: string; kind: 'text' | 'image' }[];
  sources: { label: string; href: string }[];
  canvas: { title: string; content: string } | null;
  views: AppView[];
  tables: AnswerTable[];
}

/** What an answer produced beside its words: shown under them, never folded with its steps. */
export interface Produced {
  drafts: DraftReview[];
  canvas: ChatMessage['canvas'];
  views: AppView[];
  tables: AnswerTable[];
}

export const fromStored = (m: StoredMessage): ChatMessage => ({
  id: m.messageId,
  role: m.role,
  text: m.content,
  tools: m.tools,
  drafts: m.drafts,
  attachments: (m.attachments ?? []).map((a) => ({
    attachmentId: a.attachmentId,
    name: a.name,
    kind: a.kind,
  })),
  sources: m.sources ?? [],
  canvas: m.canvas ?? null,
  views: m.views ?? [],
  tables: m.tables ?? [],
});

/** A message as assistant-ui draws it: its text, its tools (with their drafts), its sources. */
function convert(message: ChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    // Its steps first, folded; then its words; what it produced comes under them.
    content: [
      ...message.tools.map((tool, index) => ({
        type: 'tool-call' as const,
        toolCallId: `${message.id}-tool-${index}`,
        toolName: tool.name,
        args: {},
        ...(tool.state === 'running' ? {} : { result: { state: tool.state } }),
      })),
      ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
      ...message.sources.map((source, index) => ({
        type: 'source' as const,
        sourceType: 'url' as const,
        id: `${message.id}-source-${index}`,
        url: source.href,
        title: source.label,
      })),
    ],
    metadata: {
      custom: {
        produced: {
          drafts: message.drafts,
          canvas: message.canvas,
          views: message.views,
          tables: message.tables,
        } satisfies Produced,
      },
    },
    attachments: message.attachments.map((a) => ({
      id: a.attachmentId,
      type: a.kind === 'image' ? 'image' : 'document',
      name: a.name,
      status: { type: 'complete' as const },
      content: [],
    })),
  };
}

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

/** Files go to the API when the message is sent: read there, then sent with it by their ids. */
const attachments: AttachmentAdapter = {
  accept: accepted,
  async add({ file }) {
    return {
      id: crypto.randomUUID(),
      type: file.type.startsWith('image/') ? 'image' : 'document',
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  },
  async send(attachment) {
    const answer = await uploadAttachment({
      data: {
        name: attachment.name,
        contentType: attachment.contentType ?? attachment.file.type,
        data: await toBase64(attachment.file),
      },
    });
    if (!answer.ok || !answer.file) throw new Error(answer.error ?? 'upload_failed');
    return {
      ...attachment,
      id: answer.file.attachmentId,
      status: { type: 'complete' },
      content: [],
    };
  },
  async remove() {
    // Not sent yet: nothing kept anywhere.
  },
};

export function useKeteChat(options: {
  conversationId: string | null;
  initial: StoredMessage[];
  /** Who pays for the next answer (spec 026b); the API's default when null. */
  payer: Payer | null;
  onError: (code: string | null) => void;
  /** The page she asks from, beside it (spec 048). */
  page?: { kind: string; title: string; href: string } | null;
  /** Whether the address follows the conversation (the assistant's page); not beside a page. */
  followAddress?: boolean;
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(options.conversationId);
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;
  const [messages, setMessages] = useState<ChatMessage[]>(options.initial.map(fromStored));
  const [running, setRunning] = useState(false);
  // What she writes while an answer is being written waits in line (assistant-ui's own queue)
  // and leaves once the answer ends. The driver calls the latest `deliver`, kept in a ref.
  const deliver = useRef<(message: AppendMessage) => void>(() => undefined);
  const queue = useMemo(
    () =>
      createMessageQueue({
        // No `cancel` here: a message written while an answer comes waits its turn — it never
        // interrupts the answer. « Arrêter » is the only gesture that stops one.
        run: (message) => deliver.current(message),
      }),
    [],
  );
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => queue.subscribe(redraw), [queue]);
  const stopper = useRef<AbortController | null>(null);
  const payer = useRef(options.payer);
  payer.current = options.payer;
  const page = useRef(options.page ?? null);
  page.current = options.page ?? null;

  const patchLast = (change: (last: ChatMessage) => ChatMessage) =>
    setMessages((list) => [...list.slice(0, -1), change(list[list.length - 1] as ChatMessage)]);

  async function send(text: string, files: ChatMessage['attachments']) {
    options.onError(null);
    queue.notifyBusy();
    setRunning(true);
    const empty = { tools: [], drafts: [], sources: [], canvas: null, views: [], tables: [] };
    setMessages((list) => [
      ...list,
      { id: crypto.randomUUID(), role: 'user', text, ...empty, attachments: files },
      { id: crypto.randomUUID(), role: 'assistant', text: '', ...empty, attachments: [] },
    ]);
    const controller = new AbortController();
    stopper.current = controller;
    try {
      const response = await fetch('/assistant/flux', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          attachments: files.map((f) => f.attachmentId),
          ...(conversationId ? { conversationId } : {}),
          ...(payer.current ? { payer: payer.current } : {}),
          ...(page.current ? { page: page.current } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const answer = (await response.json().catch(() => ({}))) as { error?: string };
        options.onError(answer.error ?? 'model_failed');
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === 'conversation' && typeof event.conversationId === 'string') {
            if (!conversationId) {
              setConversationId(event.conversationId);
              // The address follows the conversation, without reloading the thread.
              if (options.followAddress !== false) {
                window.history.replaceState(null, '', `/assistant?c=${event.conversationId}`);
              }
            }
          } else if (event.type === 'text') {
            patchLast((last) => ({ ...last, text: last.text + String(event.delta ?? '') }));
          } else if (event.type === 'tool' && typeof event.name === 'string') {
            const tool = {
              name: event.name,
              state: (event.state as ChatMessage['tools'][number]['state']) ?? 'done',
            };
            const draft = event.draft as DraftReview | undefined;
            patchLast((last) => ({
              ...last,
              tools:
                tool.state === 'running'
                  ? [...last.tools, tool]
                  : [
                      ...last.tools.filter((t) => !(t.name === tool.name && t.state === 'running')),
                      tool,
                    ],
              drafts: draft ? [...last.drafts, draft] : last.drafts,
            }));
          } else if (event.type === 'canvas') {
            const canvas = {
              title: String(event.title ?? ''),
              content: String(event.content ?? ''),
            };
            patchLast((last) => ({ ...last, canvas }));
          } else if (event.type === 'view') {
            const view = event as unknown as AppView;
            patchLast((last) => ({ ...last, views: [...last.views, view] }));
          } else if (event.type === 'table') {
            const table = event as unknown as AnswerTable;
            patchLast((last) => ({ ...last, tables: [...last.tables, table] }));
          } else if (event.type === 'source') {
            const source = { label: String(event.label ?? ''), href: String(event.href ?? '') };
            patchLast((last) => ({ ...last, sources: [...last.sources, source] }));
          } else if (event.type === 'error') {
            options.onError(typeof event.code === 'string' ? event.code : null);
          }
        }
      }
    } catch (failure) {
      if ((failure as Error).name !== 'AbortError') options.onError(null);
    } finally {
      stopper.current = null;
      setRunning(false);
      if (options.followAddress !== false) void router.invalidate();
      // The next message in line may leave.
      queue.notifyIdle();
    }
  }

  deliver.current = (message) => {
    const text = message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim();
    const files = (message.attachments ?? []).map((a) => ({
      attachmentId: a.id,
      name: a.name,
      kind: a.type === 'image' ? ('image' as const) : ('text' as const),
    }));
    if (text) void send(text, files);
    else queue.notifyIdle();
  };

  const dictation = useMemo(
    () =>
      WebSpeechDictationAdapter.isSupported()
        ? new WebSpeechDictationAdapter({ language: 'fr-FR' })
        : undefined,
    [],
  );

  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning: running,
    convertMessage: convert,
    queue: queue.adapter,
    onNew: async (message: AppendMessage) => {
      deliver.current(message);
    },
    onCancel: async () => {
      stopper.current?.abort();
    },
    adapters: {
      attachments,
      ...(dictation ? { dictation } : {}),
      // Her opinion of an answer (spec 053), once the conversation exists.
      feedback: {
        submit: ({ message, type }) => {
          if (!conversationRef.current) return;
          void sendFeedback({
            data: {
              conversationId: conversationRef.current,
              messageId: message.id,
              helpful: type === 'positive',
            },
          });
        },
      },
    },
  });

  /** The latest document the assistant wrote in the canvas, if any. */
  const canvas = [...messages].reverse().find((m) => m.canvas)?.canvas ?? null;
  return {
    runtime,
    canvas,
    send,
    conversationId,
    running,
  };
}
