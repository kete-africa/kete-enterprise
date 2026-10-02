import { words, type Locale } from './words.js';

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface MailContent {
  locale: Locale;
  /** The organization the e-mail comes from, as people know it. */
  sender: string;
  greeting: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Why the person receives it, in one line. */
  reason: string;
}

/**
 * One plain layout for every e-mail of the business tools: readable without images, the same words
 * in HTML and text, and the action as a link a person can copy.
 */
export function renderMail(content: MailContent): { html: string; text: string } {
  const w = words(content.locale);
  const paragraphs = content.paragraphs.map((p) => `<p style="margin:0 0 14px">${escape(p)}</p>`);
  const action = content.action
    ? `<p style="margin:22px 0"><a href="${escape(content.action.url)}" style="background:#1ca18c;color:#063026;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escape(content.action.label)}</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#555">${escape(w.copyLink)}<br><span style="word-break:break-all">${escape(content.action.url)}</span></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef">
<div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2a26">
<p style="margin:0 0 18px;font-weight:600">${escape(content.sender)}</p>
<p style="margin:0 0 14px">${escape(content.greeting)}</p>
${paragraphs.join('\n')}
${action}
<p style="margin:26px 0 0;font-size:12px;color:#666">${escape(content.reason)} ${escape(w.personal)}</p>
</div></body></html>`;
  const text = [
    content.sender,
    '',
    content.greeting,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.action ? [`${content.action.label} : ${content.action.url}`, ''] : []),
    `${content.reason} ${w.personal}`,
  ].join('\n');
  return { html, text };
}
