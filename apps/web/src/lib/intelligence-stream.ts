import { newTurn, type PickedItem, type Turn } from '@kete/intelligence';
import type {
  AnswerTable as Table,
  AppView as View,
  DraftReview,
  StoredMessage,
} from '@/lib/workspace';

// The center's stream told as Kete Intelligence's contract (spec 085; kete-core spec 101): pure,
// so the translation is proven without a screen.

/** What an answer brought beyond the contract, shown after its words. */
export interface Extras {
  tables: Table[];
  views: View[];
  canvas: { title: string; content: string } | null;
  conversationId: string | null;
}

export const noExtras = (conversationId: string | null): Extras => ({
  tables: [],
  views: [],
  canvas: null,
  conversationId,
});

// What she cites (@) and asks (/) travels as the directives the center reads (spec 027):
// `:person[Kossi Adjo]{name=usr_…}`, `:app[…]{name=res_…}`, `:command[résumer]{name=summarize}`.
const directive = /:([\w-]+)\[([^\]]+)\](?:\{name=([^}]+)\})?/g;

/** Her question with what she picked written as directives, for the center. */
export function encode(question: string, picks: readonly PickedItem[]): string {
  let said = question;
  for (const pick of picks) {
    const [type, id] =
      pick.kind === 'gesture' ? ['command', pick.id] : (pick.id.split(':', 2) as [string, string]);
    said = said.replace(
      `${pick.kind === 'gesture' ? '/' : '@'}${pick.label}`,
      `:${type}[${pick.label}]{name=${id}}`,
    );
  }
  return said;
}

/** A message as she reads it: what she cited with @, what she asked with /. */
export function plainOf(text: string): string {
  return text.replace(directive, (_all, type: string, label: string) =>
    type === 'command' ? `/${label}` : `@${label}`,
  );
}

/** A thread opened again: its questions and answers as turns, their drafts and extras. */
export function fromStored(messages: readonly StoredMessage[], conversationId: string | null) {
  const turns: Turn[] = [];
  const extras: Extras[] = [];
  const drafts: Record<string, DraftReview> = {};
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ ...newTurn(message.messageId, plainOf(message.content)), state: 'done' });
      extras.push(noExtras(conversationId));
      continue;
    }
    const turn = turns.at(-1);
    const extra = extras.at(-1);
    if (!turn || !extra) continue;
    turn.text = message.content;
    turn.tools = message.tools.map((tool, index) => ({
      id: `${message.messageId}-${index}`,
      name: tool.name,
      level: 1,
      state: tool.state === 'refused' ? 'failed' : 'done',
    }));
    turn.drafts = message.drafts.map((draft) => ({ id: draft.draftId, title: draft.description }));
    for (const draft of message.drafts) drafts[draft.draftId] = draft;
    turn.sources = message.sources ?? [];
    extra.tables = message.tables ?? [];
    extra.views = message.views ?? [];
    extra.canvas = message.canvas ?? null;
  }
  return { turns, extras, drafts };
}

/** What one event of the center's stream gives: contract lines, and what the screen keeps aside. */
export interface Translated {
  lines: object[];
  conversationId?: string;
  draft?: DraftReview;
  extra?: (extra: Extras) => Extras;
}

/**
 * One answer's translator: each event of the center's stream (/assistant/flux) becomes the lines
 * of `intelligence-event.v1`; the gestures counted for the tally at `done`.
 */
export function translator(started: number, now: () => number = Date.now) {
  let tools = 0;
  return (event: Record<string, unknown>): Translated => {
    switch (event.type) {
      case 'conversation':
        return typeof event.conversationId === 'string'
          ? {
              lines: [],
              conversationId: event.conversationId,
              extra: (extra) => ({ ...extra, conversationId: String(event.conversationId) }),
            }
          : { lines: [] };
      case 'text':
        return { lines: [{ type: 'text', delta: String(event.delta ?? '') }] };
      case 'tool': {
        const state =
          event.state === 'running' ? 'running' : event.state === 'refused' ? 'failed' : 'done';
        if (state !== 'running') tools += 1;
        const lines: object[] = [
          {
            type: 'tool',
            id: String(event.id ?? event.name),
            name: String(event.name),
            level: typeof event.level === 'number' ? event.level : 1,
            state,
            ...(typeof event.input === 'string' ? { input: event.input } : {}),
          },
        ];
        const draft = event.draft as DraftReview | undefined;
        if (!draft) return { lines };
        lines.push({ type: 'draft', draft_id: draft.draftId, title: draft.description });
        return { lines, draft };
      }
      case 'source':
        return {
          lines: [
            { type: 'source', label: String(event.label ?? ''), href: String(event.href ?? '') },
          ],
        };
      case 'table':
        return {
          lines: [],
          extra: (extra) => ({ ...extra, tables: [...extra.tables, event as unknown as Table] }),
        };
      case 'view':
        return {
          lines: [],
          extra: (extra) => ({ ...extra, views: [...extra.views, event as unknown as View] }),
        };
      case 'canvas':
        return {
          lines: [],
          extra: (extra) => ({
            ...extra,
            canvas: { title: String(event.title ?? ''), content: String(event.content ?? '') },
          }),
        };
      case 'error':
        return {
          lines: [
            {
              type: 'failed',
              reason: typeof event.code === 'string' ? event.code : 'model_failed',
            },
          ],
        };
      case 'done':
        return { lines: [{ type: 'done', tools, ms: now() - started }] };
      default:
        return { lines: [] };
    }
  };
}
