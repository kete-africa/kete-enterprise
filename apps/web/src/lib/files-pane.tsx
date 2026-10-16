import { CanvasIcon } from '@kete/design';
import { useEffect, useRef, useState } from 'react';
import { fetchMyDocuments, type GeneratedDocument } from '@/lib/documents';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// The drawer's « Fichiers » tab (spec 085; canvas v3.1): a file dropped here joins her next
// question; her recent documents are one click away.

/** The short kind a file's square shows: PDF, DOC, XLS, IMG. */
function kindOf(contentType: string): { label: string; tone: string } {
  if (contentType === 'application/pdf')
    return { label: 'PDF', tone: 'bg-error-surface text-error-ink' };
  if (contentType.startsWith('image/'))
    return { label: 'IMG', tone: 'bg-info-surface text-info-ink' };
  if (/sheet|excel|csv/.test(contentType)) {
    return { label: 'XLS', tone: 'bg-success-surface text-success-ink' };
  }
  return { label: 'DOC', tone: 'bg-surface-selected text-fg-soft' };
}

export function FilesPane({
  accept,
  onFiles,
}: {
  accept: string;
  /** The files she dropped or chose: they join her next question. */
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const [recent, setRecent] = useState<GeneratedDocument[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void fetchMyDocuments()
      .then((found) => setRecent(found.documents.slice(0, 8)))
      .catch(() => setRecent([]));
  }, []);
  return (
    <div className="flex flex-col gap-[18px] p-4">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          onFiles([...event.dataTransfer.files]);
        }}
        className={`rounded-[5px] border border-dashed p-[18px] text-center text-[13px] leading-[1.55] ${
          over ? 'border-accent bg-surface-selected text-fg' : 'border-line-strong text-fg-muted'
        }`}
      >
        <span className="inline-grid" aria-hidden="true">
          <CanvasIcon name="upload" size={18} />
        </span>
        <p className="m-0 mt-1">{m.intelligence_files_drop()}</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-2 inline-flex h-7 items-center rounded-[5px] border border-line-control bg-surface-control px-2.5 text-[13px] font-semibold text-fg hover:bg-surface-hover"
        >
          {m.intelligence_files_choose()}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </div>
      <section>
        <h3 className="m-0 mb-1.5 ml-2 text-[12px] font-normal uppercase tracking-[.04em] text-fg-muted">
          {m.intelligence_files_recent()}
        </h3>
        {recent && recent.length === 0 && (
          <p className="m-0 ml-2 text-[13px] text-fg-muted">{m.intelligence_files_none()}</p>
        )}
        <ul className="m-0 list-none p-0">
          {recent?.map((document) => {
            const kind = kindOf(document.contentType);
            return (
              <li key={document.documentId}>
                <a
                  href={document.href}
                  className="flex items-center gap-2.5 rounded-[5px] px-2 py-[7px] text-fg no-underline hover:bg-surface-hover"
                >
                  <span
                    aria-hidden="true"
                    className={`grid h-[38px] w-8 flex-none place-items-center rounded-[5px] font-mono text-[10px] font-semibold ${kind.tone}`}
                  >
                    {kind.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold">{document.name}</b>
                    <small className="text-[12px] text-fg-muted">
                      {new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(
                        new Date(document.createdAt),
                      )}
                    </small>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
