import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_defaultDirectiveFormatter,
  type SourceMessagePartComponent,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  type Unstable_TriggerItem,
} from '@assistant-ui/react';
import { Icon, IconButton, Markdown, Tag, ToolCard } from '@kete/design';
import type { ComponentProps, FC, ReactNode } from 'react';
import { DraftCard } from '@/lib/draft-card';
import type { AppView as AppViewData, DraftReview } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { AppView } from './app-view';

// The chat's thread on assistant-ui's primitives (spec 027), dressed with @kete/design's tokens
// and components: the conversation, the tools as cards with their drafts, the sources, the files,
// and a composer that attaches, dictates, mentions (@) and runs commands (/).

/** The words of a tool the assistant called. */
function toolLabel(name: string): string {
  const labels: Record<string, () => string> = {
    my_day: m.tool_my_day,
    schedule_task: m.tool_schedule_task,
    structure_chart: m.tool_structure_chart,
    registry_list: m.tool_registry_list,
    registry_register: m.tool_registry_register,
    decisions_inbox: m.tool_decisions_inbox,
    performance_readings_to_take: m.tool_readings_to_take,
    performance_propose_measure: m.tool_propose_measure,
    actions_propose: m.tool_actions_propose,
    canvas_write: m.tool_canvas_write,
  };
  return labels[name]?.() ?? name;
}

const toolState = (state: 'running' | 'done' | 'refused') =>
  ({ running: m.tool_running, done: m.tool_done, refused: m.tool_refused })[state]();

/** What a person reads of a message: directives (@, /) as tags, the rest as written. */
const UserText: TextMessagePartComponent = ({ text }) => {
  const segments = unstable_defaultDirectiveFormatter.parse(text);
  return (
    <p className="whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <Tag key={index} tone="info">
            {segment.label}
          </Tag>
        ),
      )}
    </p>
  );
};

const AssistantText: TextMessagePartComponent = ({ text }) => <Markdown text={text} />;

/** What a trigger (@ or /) offers: the adapter assistant-ui's popover reads. */
export type TriggerAdapter = NonNullable<
  ComponentProps<typeof ComposerPrimitive.Unstable_TriggerPopover>['adapter']
>;

const Source: SourceMessagePartComponent = ({ url = '#', title }) => (
  <a
    href={url}
    className="inline-flex max-w-full items-center gap-1 rounded-control border border-line bg-surface px-2 py-0.5 text-body-sm text-link underline"
    {...(url.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
  >
    <Icon name="library" size={14} />
    <span className="truncate">{title ?? url}</span>
  </a>
);

export interface ToolViews {
  /** Opens the canvas with a document the assistant wrote. */
  openCanvas: (canvas: { title: string; content: string }) => void;
  /** Where the apps' views run (spec 030); none shown without it. */
  sandboxUrl: string | null;
}

function makeToolCard(views: ToolViews): ToolCallMessagePartComponent {
  const Card: ToolCallMessagePartComponent = ({ toolName, result }) => {
    const outcome = (result ?? null) as {
      state?: 'done' | 'refused';
      drafts?: DraftReview[];
      canvas?: { title: string; content: string } | null;
      view?: AppViewData | null;
    } | null;
    const state = outcome?.state ?? 'running';
    return (
      <div className="my-2 grid gap-2">
        <ToolCard name={toolLabel(toolName)} state={state} stateLabel={toolState(state)}>
          {outcome?.canvas && (
            <button
              type="button"
              onClick={() => views.openCanvas(outcome.canvas as { title: string; content: string })}
              className="mt-1 inline-flex items-center gap-2 font-semibold text-link underline"
            >
              <Icon name="panel" size={16} />
              {m.canvas_open({ title: outcome.canvas.title })}
            </button>
          )}
        </ToolCard>
        {(outcome?.drafts ?? []).map((draft) => (
          <DraftCard key={draft.draftId} draft={draft} />
        ))}
        {outcome?.view && views.sandboxUrl && (
          <AppView view={outcome.view} sandboxUrl={views.sandboxUrl} />
        )}
      </div>
    );
  };
  return Card;
}

const MessageAttachment: FC = () => (
  <AttachmentPrimitive.Root className="inline-flex max-w-full items-center gap-2 rounded-control border border-line bg-surface px-2 py-1 text-body-sm">
    <Icon name="file" size={16} />
    <span className="truncate font-semibold">
      <AttachmentPrimitive.Name />
    </span>
  </AttachmentPrimitive.Root>
);

const ComposerAttachment: FC = () => (
  <AttachmentPrimitive.Root className="inline-flex max-w-full items-center gap-2 rounded-control border border-line bg-surface px-2 py-1 text-body-sm">
    <Icon name="file" size={16} />
    <span className="truncate font-semibold">
      <AttachmentPrimitive.Name />
    </span>
    <AttachmentPrimitive.Remove
      aria-label={m.chat_attachment_remove()}
      className="rounded-[3px] p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
    >
      <Icon name="close" size={14} />
    </AttachmentPrimitive.Remove>
  </AttachmentPrimitive.Root>
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root className="flex justify-end py-2">
    <div className="grid max-w-[85%] justify-items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1.5">
        <MessagePrimitive.Attachments components={{ Attachment: MessageAttachment }} />
      </div>
      <div className="rounded-box bg-surface-selected px-4 py-2.5 text-fg">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </div>
  </MessagePrimitive.Root>
);

function makeAssistantMessage(views: ToolViews): FC {
  const ToolCardView = makeToolCard(views);
  const AssistantMessage: FC = () => (
    <MessagePrimitive.Root className="grid gap-1.5 py-2">
      <p className="text-body-sm font-semibold text-fg-muted">{m.nav_assistant()}</p>
      <div className="min-w-0 text-fg">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            Source,
            tools: { Fallback: ToolCardView },
          }}
        />
        <MessagePrimitive.If hasContent={false}>
          <p className="text-fg-muted">{m.assistant_thinking()}</p>
        </MessagePrimitive.If>
      </div>
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="flex gap-1">
        <ActionBarPrimitive.Copy asChild>
          <IconButton label={m.common_copy()}>
            <Icon name="copy" size={16} />
          </IconButton>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <IconButton label={m.assistant_again()}>
            <Icon name="refresh" size={16} />
          </IconButton>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
  return AssistantMessage;
}

/** The popover of a trigger (@ or /): its categories, then their items. */
const TriggerPopover: FC<{ char: string; adapter: TriggerAdapter; label: string }> = ({
  char,
  adapter,
  label,
}) => (
  <ComposerPrimitive.Unstable_TriggerPopover
    char={char}
    adapter={adapter}
    aria-label={label}
    className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-menu border border-line-overlay bg-surface-raised p-1.5 shadow-[0_8px_24px_#0005]"
  >
    <ComposerPrimitive.Unstable_TriggerPopover.Directive
      formatter={unstable_defaultDirectiveFormatter}
    />
    <ComposerPrimitive.Unstable_TriggerPopoverCategories>
      {(categories) => (
        <div className="grid">
          {categories.map((category) => (
            <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
              key={category.id}
              categoryId={category.id}
              className="flex cursor-pointer items-center justify-between rounded-control px-3 py-2 text-body-sm outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-selected"
            >
              {category.label}
              <Icon name="chevron" size={14} />
            </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
          ))}
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverCategories>
    <ComposerPrimitive.Unstable_TriggerPopoverItems>
      {(items) => (
        <div className="grid">
          <ComposerPrimitive.Unstable_TriggerPopoverBack className="cursor-pointer px-3 py-1.5 text-body-sm text-fg-muted hover:bg-surface-hover">
            {m.chat_back()}
          </ComposerPrimitive.Unstable_TriggerPopoverBack>
          {items.length === 0 && (
            <p className="px-3 py-2 text-body-sm text-fg-muted">{m.chat_no_match()}</p>
          )}
          {items.map((item, index) => (
            <ComposerPrimitive.Unstable_TriggerPopoverItem
              key={item.id}
              item={item}
              index={index}
              className="grid cursor-pointer gap-0.5 rounded-control px-3 py-2 text-start outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-selected"
            >
              <span className="font-semibold">{item.label}</span>
              {item.description && (
                <span className="text-body-sm text-fg-muted">{item.description}</span>
              )}
            </ComposerPrimitive.Unstable_TriggerPopoverItem>
          ))}
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  </ComposerPrimitive.Unstable_TriggerPopover>
);

/** An adapter from fixed categories of items: what @ and / offer. */
export function triggerAdapter(
  categories: { id: string; label: string; items: Unstable_TriggerItem[] }[],
): TriggerAdapter {
  const all = categories.flatMap((c) => c.items);
  return {
    categories: () =>
      categories.filter((c) => c.items.length > 0).map(({ id, label }) => ({ id, label })),
    categoryItems: (id: string) => categories.find((c) => c.id === id)?.items ?? [],
    search: (query: string) => {
      const q = query.toLowerCase();
      return all.filter((item) => item.label.toLowerCase().includes(q));
    },
  };
}

const Composer: FC<{
  mentions: TriggerAdapter;
  commands: TriggerAdapter;
  hint: ReactNode;
}> = ({ mentions, commands, hint }) => (
  <div className="sticky bottom-0 bg-canvas pt-2 pb-3">
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="relative">
        <TriggerPopover char="@" adapter={mentions} label={m.chat_mentions()} />
        <TriggerPopover char="/" adapter={commands} label={m.chat_commands()} />
        <ComposerPrimitive.AttachmentDropzone className="flex flex-wrap items-end gap-2 rounded-overlay border border-line-control bg-surface-control px-3 py-2 focus-within:border-accent data-[dragging=true]:border-dashed data-[dragging=true]:border-accent">
          <div className="flex w-full flex-wrap gap-2 empty:hidden">
            <ComposerPrimitive.Attachments components={{ Attachment: ComposerAttachment }} />
          </div>
          <ComposerPrimitive.AddAttachment asChild>
            <IconButton label={m.chat_attach()}>
              <Icon name="attach" size={18} />
            </IconButton>
          </ComposerPrimitive.AddAttachment>
          <ComposerPrimitive.Input
            rows={1}
            placeholder={m.assistant_placeholder()}
            aria-label={m.assistant_message()}
            className="max-h-[196px] min-h-[38px] flex-1 resize-none border-0 bg-transparent py-2 text-fg outline-0 placeholder:text-fg-muted"
          />
          <AuiIf condition={(s) => s.thread.capabilities.dictation}>
            <AuiIf condition={(s) => s.composer.dictation == null}>
              <ComposerPrimitive.Dictate asChild>
                <IconButton label={m.chat_dictate()}>
                  <Icon name="mic" size={18} />
                </IconButton>
              </ComposerPrimitive.Dictate>
            </AuiIf>
            <AuiIf condition={(s) => s.composer.dictation != null}>
              <ComposerPrimitive.StopDictation asChild>
                <IconButton label={m.chat_dictate_stop()} className="text-state-error-fg">
                  <Icon name="stop" size={18} />
                </IconButton>
              </ComposerPrimitive.StopDictation>
            </AuiIf>
          </AuiIf>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send asChild>
              <IconButton
                label={m.assistant_send()}
                className="bg-action text-on-action hover:bg-action-strong disabled:opacity-40"
              >
                <Icon name="send" size={18} />
              </IconButton>
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <IconButton label={m.assistant_stop()}>
                <Icon name="stop" size={18} />
              </IconButton>
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    <p className="mt-1.5 px-1 text-body-sm text-fg-muted">{hint}</p>
  </div>
);

/** The whole thread: welcome and suggestions when empty, the messages, the composer. */
export function KeteThread(props: {
  welcome: ReactNode;
  suggestions: string[];
  mentions: TriggerAdapter;
  commands: TriggerAdapter;
  hint: ReactNode;
  views: ToolViews;
}) {
  const AssistantMessage = makeAssistantMessage(props.views);
  return (
    <ThreadPrimitive.Root className="flex min-h-[60vh] min-w-0 flex-col">
      <ThreadPrimitive.Viewport aria-label={m.assistant_thread()} className="flex flex-1 flex-col">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="flex flex-col gap-4 py-6">
            <p className="font-heading text-title">{props.welcome}</p>
            <div className="flex flex-wrap gap-2" aria-label={m.assistant_suggestions()}>
              {props.suggestions.map((prompt) => (
                <ThreadPrimitive.Suggestion
                  key={prompt}
                  prompt={prompt}
                  send
                  className="rounded-control border border-line-control px-3 py-2 text-body-sm font-semibold text-fg hover:bg-surface-hover"
                >
                  {prompt}
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </div>
        </AuiIf>
        <div role="log" aria-live="polite" className="grid">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </div>
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto">
          <Composer mentions={props.mentions} commands={props.commands} hint={props.hint} />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
