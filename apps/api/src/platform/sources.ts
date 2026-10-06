// What a tool read, as a person can open it: the chat cites it (spec 048), « Comment ? » lists
// it beside an agent's step (spec 056).

export interface Source {
  label: string;
  href: string;
}

/**
 * The sources a tool's output names: every object with a label (title, name) and an address
 * (href, url, address) — a record of an app, a document. At most five per answer.
 */
export function sourcesOf(output: unknown, found: Source[] = [], depth = 0): Source[] {
  if (depth > 5 || found.length >= 5 || output === null || typeof output !== 'object') {
    return found;
  }
  if (Array.isArray(output)) {
    for (const item of output) sourcesOf(item, found, depth + 1);
    return found;
  }
  const record = output as Record<string, unknown>;
  const label = [record.title, record.name, record.label].find((v) => typeof v === 'string');
  const href = [record.href, record.url, record.address].find(
    (v) => typeof v === 'string' && /^(https:\/\/|\/)/.test(v),
  );
  if (typeof label === 'string' && typeof href === 'string') {
    if (!found.some((s) => s.href === href)) found.push({ label: label.slice(0, 120), href });
  }
  for (const value of Object.values(record)) sourcesOf(value, found, depth + 1);
  return found;
}
