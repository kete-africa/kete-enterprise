import { Drawer, Icon } from '@kete/design';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { fetchAttachment } from './api';
import type { ChatMessage } from './runtime';

// The files and media of a thread, listed once (spec 064): what the assistant and the agents
// produced, what people sent, the records and documents it cited — each opens where it lives.

type Sent = ChatMessage['attachments'][number];

export function threadPieces(messages: readonly ChatMessage[]) {
  const produced: { key: string; label: string; open?: { title: string; content: string } }[] = [];
  const sent: Sent[] = [];
  const links: { label: string; href: string }[] = [];
  for (const message of messages) {
    if (message.canvas) {
      produced.push({
        key: `${message.id}-canvas`,
        label: message.canvas.title,
        open: message.canvas,
      });
    }
    message.tables.forEach((table, index) =>
      produced.push({ key: `${message.id}-table-${index}`, label: table.title }),
    );
    for (const file of message.attachments) {
      if (!sent.some((one) => one.attachmentId === file.attachmentId)) sent.push(file);
    }
    for (const source of message.sources) {
      if (!links.some((one) => one.href === source.href)) links.push(source);
    }
  }
  return { produced, sent, links, count: produced.length + sent.length + links.length };
}

/** A file she sent, opened again: an image as it is, a text as it was read. */
function SentViewer({
  file,
  images,
  onPick,
}: {
  file: Sent;
  images: Sent[];
  onPick: (f: Sent) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const at = images.findIndex((one) => one.attachmentId === file.attachmentId);
  if (file.kind === 'image') {
    return (
      <figure className="grid gap-2">
        <img
          src={`/api/pieces/${file.attachmentId}`}
          alt={file.name}
          className="max-h-[60vh] w-full rounded-box border border-line object-contain"
        />
        <figcaption className="flex items-center justify-between gap-2 text-body-sm text-fg-muted">
          <span className="truncate">{file.name}</span>
          {images.length > 1 && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={m.pieces_previous()}
                disabled={at <= 0}
                onClick={() => onPick(images[at - 1] as Sent)}
                className="rounded-control px-2 py-1 font-semibold hover:bg-surface-hover disabled:opacity-40"
              >
                ‹
              </button>
              {m.pieces_position({ at: String(at + 1), of: String(images.length) })}
              <button
                type="button"
                aria-label={m.pieces_next()}
                disabled={at >= images.length - 1}
                onClick={() => onPick(images[at + 1] as Sent)}
                className="rounded-control px-2 py-1 font-semibold hover:bg-surface-hover disabled:opacity-40"
              >
                ›
              </button>
            </span>
          )}
        </figcaption>
      </figure>
    );
  }
  if (text === null && !failed) {
    void fetchAttachment({ data: { attachmentId: file.attachmentId } })
      .then((found) => (found ? setText(found.text) : setFailed(true)))
      .catch(() => setFailed(true));
  }
  return (
    <div className="grid gap-2">
      <p className="font-semibold">{file.name}</p>
      {failed ? (
        <p className="text-fg-muted">{m.pieces_unreadable()}</p>
      ) : (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-box border border-line bg-surface p-3 font-ui text-body-sm">
          {text ?? m.pieces_reading()}
        </pre>
      )}
    </div>
  );
}

/** The thread's files and media, in a drawer beside it. */
export function ThreadPieces({
  messages,
  openCanvas,
}: {
  messages: readonly ChatMessage[];
  openCanvas: (canvas: { title: string; content: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Sent | null>(null);
  const pieces = threadPieces(messages);
  const images = pieces.sent.filter((file) => file.kind === 'image');
  if (pieces.count === 0) return null;
  const heading = 'mb-1.5 mt-3 text-body-sm font-semibold text-fg-muted first:mt-0';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-control border border-line-control px-3 py-1.5 text-body-sm font-semibold hover:bg-surface-hover"
      >
        <Icon name="file" size={16} />
        {m.pieces_open({ count: String(pieces.count) })}
      </button>
      <Drawer
        open={open}
        onClose={() => {
          setOpen(false);
          setViewing(null);
        }}
        title={viewing ? viewing.name : m.pieces_title()}
        closeLabel={m.common_close()}
      >
        {viewing ? (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="justify-self-start text-body-sm font-semibold text-link underline"
            >
              {m.pieces_back()}
            </button>
            <SentViewer file={viewing} images={images} onPick={setViewing} />
          </div>
        ) : (
          <div className="grid">
            {pieces.produced.length > 0 && (
              <>
                <h3 className={heading}>{m.pieces_produced()}</h3>
                <ul className="grid gap-1">
                  {pieces.produced.map((item) => (
                    <li key={item.key}>
                      {item.open ? (
                        <button
                          type="button"
                          onClick={() => {
                            openCanvas(item.open as { title: string; content: string });
                            setOpen(false);
                          }}
                          className="font-semibold text-link underline"
                        >
                          {item.label}
                        </button>
                      ) : (
                        <span>{item.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pieces.sent.length > 0 && (
              <>
                <h3 className={heading}>{m.pieces_sent()}</h3>
                <ul className="grid gap-1">
                  {pieces.sent.map((file) => (
                    <li key={file.attachmentId}>
                      <button
                        type="button"
                        onClick={() => setViewing(file)}
                        className="inline-flex items-center gap-2 font-semibold text-link underline"
                      >
                        <Icon name="file" size={14} />
                        {file.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pieces.links.length > 0 && (
              <>
                <h3 className={heading}>{m.pieces_links()}</h3>
                <ul className="grid gap-1">
                  {pieces.links.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} className="font-semibold text-link underline">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
