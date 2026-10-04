import mammoth from 'mammoth';
import { extractText } from 'unpdf';

// What a file says, read with existing libraries (specs 027, 028): PDF (unpdf), Word (mammoth),
// plain text, CSV, Markdown, JSON. An image is kept as it is: the model reads it. A PDF's text is
// also kept page by page, so that the library cites its pages.

export type AttachmentKind = 'text' | 'image';

export interface Extracted {
  kind: AttachmentKind;
  /** The file's text, for the model (empty for an image). */
  text: string;
  pages: number | null;
  /** The text page by page (one entry when the file has no pages). */
  pageTexts: string[];
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
  if (images.has(contentType)) return { kind: 'image', text: '', pages: null, pageTexts: [] };
  if (contentType === 'application/pdf') {
    const { totalPages, text } = await extractText(new Uint8Array(data), { mergePages: false });
    const pageTexts = (text as string[]).map((t) => String(t).trim());
    return { kind: 'text', text: pageTexts.join('\n\n').trim(), pages: totalPages, pageTexts };
  }
  if (contentType === word) {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { kind: 'text', text: value.trim(), pages: null, pageTexts: [value.trim()] };
  }
  const text = data.toString('utf8').trim();
  return { kind: 'text', text, pages: null, pageTexts: [text] };
}
