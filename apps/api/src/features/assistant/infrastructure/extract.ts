import mammoth from 'mammoth';
import { extractText } from 'unpdf';

// What a file attached to the chat says, read with existing libraries (spec 027): PDF (unpdf),
// Word (mammoth), plain text, CSV, Markdown, JSON. An image is kept as it is: the model reads it.

export type AttachmentKind = 'text' | 'image';

export interface Extracted {
  kind: AttachmentKind;
  /** The file's text, for the model (empty for an image). */
  text: string;
  pages: number | null;
}

const images = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const texts = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'text/tab-separated-values',
]);
const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Whether the chat reads this kind of file. */
export function readable(contentType: string): boolean {
  return (
    images.has(contentType) ||
    texts.has(contentType) ||
    contentType === 'application/pdf' ||
    contentType === word
  );
}

export async function extract(contentType: string, data: Buffer): Promise<Extracted> {
  if (images.has(contentType)) return { kind: 'image', text: '', pages: null };
  if (contentType === 'application/pdf') {
    const { totalPages, text } = await extractText(new Uint8Array(data), { mergePages: true });
    return { kind: 'text', text: String(text).trim(), pages: totalPages };
  }
  if (contentType === word) {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { kind: 'text', text: value.trim(), pages: null };
  }
  return { kind: 'text', text: data.toString('utf8').trim(), pages: null };
}
