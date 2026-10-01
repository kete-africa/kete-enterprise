// Fails when an app component shows text that does not come from its message catalogs: every
// screen exists in French and English (constitution, doctrine D-013). It looks at JSX text between
// tags and at the attributes a person reads or hears. Punctuation, symbols and numbers pass; words
// do not, except the brand.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCOPES = ['apps'];
const ALLOWED = new Set(['kete', 'Kete']);
const VISIBLE_ATTRIBUTES = ['title', 'alt', 'placeholder', 'aria-label', 'aria-description'];
const LETTERS = /\p{L}{2,}/u;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'paraglide' ? [] : files(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** True when the text holds a word that is not the brand. */
function hasWords(text: string): boolean {
  const rest = text
    .split(/\s+/)
    .filter((word) => !ALLOWED.has(word))
    .join(' ');
  return LETTERS.test(rest);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

const problems: string[] = [];
const apps = SCOPES.flatMap((scope) => {
  const folder = join(ROOT, scope);
  return existsSync(folder) ? readdirSync(folder).map((name) => join(folder, name)) : [];
});
for (const app of apps) {
  const src = join(app, 'src');
  if (!existsSync(src)) continue;
  for (const file of files(src)) {
    const where = relative(ROOT, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    // Text nodes: after a tag's closing ">" and before the next "<" or "{". The ">" of an arrow
    // function (=>) opens no text.
    for (const match of source.matchAll(/(?<!=)>([^<>{}]+)(?=[<{])/g)) {
      const text = (match[1] ?? '').trim();
      if (!text || !hasWords(text)) continue;
      // TypeScript generics and arrow bodies can look like text to a regex.
      if (/[;=()]|=>|\b(const|return|type|import)\b/.test(text)) continue;
      problems.push(`${where}:${lineOf(source, match.index)} text "${text}"`);
    }
    for (const attribute of VISIBLE_ATTRIBUTES) {
      for (const match of source.matchAll(new RegExp(`\\b${attribute}="([^"]*)"`, 'g'))) {
        if (hasWords(match[1] ?? '')) {
          problems.push(`${where}:${lineOf(source, match.index)} ${attribute}="${match[1]}"`);
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Visible text must come from the message catalogs:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`No hard-coded visible text in ${apps.length} app(s).`);
