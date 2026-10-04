import { CopyButton, Icon, IconButton, Markdown } from '@kete/design';
import { useEffect, useId, useState } from 'react';
import { canvasPdf } from '@/lib/documents';
import { refusal } from '@/lib/forms';
import * as m from '@/paraglide/messages.js';

/**
 * The side canvas (spec 027): the document the assistant wrote, beside the conversation, where the
 * person reads it, edits it, copies it or downloads it. Edits stay hers, in her browser, until she
 * copies or downloads them.
 */
export function ChatCanvas({
  canvas,
  pdf = false,
  onClose,
}: {
  canvas: { title: string; content: string };
  /** Whether the organization turns documents into PDF (spec 038). */
  pdf?: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [text, setText] = useState(canvas.content);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Her edited text becomes her PDF, kept with her documents; the browser downloads it.
  const exportPdf = () => {
    setExporting(true);
    setRefused(null);
    void canvasPdf({ data: { title: canvas.title, markdown: text } })
      .then((answer) => {
        if (!answer.ok) return setRefused(refusal(answer.error));
        window.location.assign((answer.data as { document: { href: string } }).document.href);
      })
      .catch(() => setRefused(m.error_generic()))
      .finally(() => setExporting(false));
  };
  useEffect(() => {
    setText(canvas.content);
    setEditing(false);
  }, [canvas]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${canvas.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'document'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <aside
      aria-labelledby={titleId}
      className="flex min-h-[60vh] flex-col rounded-box border border-line bg-surface min-[1101px]:sticky min-[1101px]:top-4 min-[1101px]:max-h-[calc(100dvh-2rem)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={titleId} className="min-w-0 truncate font-heading text-title font-semibold">
          {canvas.title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="rounded-control px-2 py-1 text-body-sm font-semibold text-fg hover:bg-surface-hover"
          >
            {editing ? m.canvas_preview() : m.canvas_edit()}
          </button>
          <CopyButton text={text} label={m.canvas_copy()} copiedLabel={m.common_copied()} />
          {pdf && (
            <button
              type="button"
              disabled={exporting}
              onClick={exportPdf}
              className="rounded-control px-2 py-1 text-body-sm font-semibold text-fg hover:bg-surface-hover"
            >
              {m.canvas_pdf()}
            </button>
          )}
          <IconButton label={m.canvas_download()} onClick={download}>
            <Icon name="download" size={18} />
          </IconButton>
          <IconButton label={m.canvas_close()} onClick={onClose}>
            <Icon name="close" />
          </IconButton>
        </div>
      </header>
      {refused && (
        <p role="alert" className="px-5 pt-3 text-body-sm text-state-error-fg">
          {refused}
        </p>
      )}
      <div className="flex-1 overflow-auto px-5 py-4">
        {editing ? (
          <textarea
            aria-label={m.canvas_label()}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-full min-h-[50vh] w-full resize-none rounded-control border border-line-control bg-surface-control p-3 font-number text-body-sm text-fg"
          />
        ) : (
          <Markdown text={text} />
        )}
      </div>
    </aside>
  );
}
