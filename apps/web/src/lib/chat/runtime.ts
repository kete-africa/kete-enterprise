import {
  useExternalStoreRuntime,
  WebSpeechDictationAdapter,
  type AppendMessage,
  type AttachmentAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useRouter } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import type { DraftReview, Payer, StoredMessage } from '@/lib/workspace';
import { uploadAttachment } from './api';

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
});

/** A message as assistant-ui draws it: its text, its tools (with their drafts), its sources. */
function convert(message: ChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: [
      ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
      ...message.tools.map((tool, index) => ({
        type: 'tool-call' as const,
        toolCallId: `${message.id}-tool-${index}`,
        toolName: tool.name,
        args: {},
        ...(tool.state === 'running'
          ? {}
          : {
              result: {
                state: tool.state,
                drafts:
                  index === message.tools.length - 1
                    ? (message.drafts as unknown as Record<string, unknown>[])
                    : [],
                canvas: tool.name === 'canvas_write' ? message.canvas : null,
              },
            }),
      })),
      ...message.sources.map((source, index) => ({
        type: 'source' as const,
        sourceType: 'url' as const,
        id: `${message.id}-source-${index}`,
        url: source.href,
        title: source.label,
      })),
    ],
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
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(options.conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(options.initial.map(fromStored));
  const [running, setRunning] = useState(false);
  const stopper = useRef<AbortController | null>(null);
  const payer = useRef(options.payer);
  payer.current = options.payer;

  const patchLast = (change: (last: ChatMessage) => ChatMessage) =>
    setMessages((list) => [...list.slice(0, -1), change(list[list.length - 1] as ChatMessage)]);

  async function send(text: string, files: ChatMessage['attachments']) {
    options.onError(null);
    setRunning(true);
    const empty = { tools: [], drafts: [], sources: [], canvas: null };
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
              window.history.replaceState(null, '', `/assistant?c=${event.conversationId}`);
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
      void router.invalidate();
    }
  }

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
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim();
      const files = (message.attachments ?? []).map((a) => ({
        attachmentId: a.id,
        name: a.name,
        kind: a.type === 'image' ? ('image' as const) : ('text' as const),
      }));
      if (text) await send(text, files);
    },
    onCancel: async () => {
      stopper.current?.abort();
    },
    adapters: { attachments, ...(dictation ? { dictation } : {}) },
  });

  /** The latest document the assistant wrote in the canvas, if any. */
  const canvas = [...messages].reverse().find((m) => m.canvas)?.canvas ?? null;
  return { runtime, canvas, send };
}
