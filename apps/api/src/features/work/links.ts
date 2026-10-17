import type { Holding } from '@kete/work';
import { APP, sourceKinds, type SourceKind } from './sources.js';

// Where a holding opens (specs 087, 089, 091): the address its app gave it; the object's thread or
// the card « à classer » for the threads and the router; the center's own page for its sources.

/** Where the holdings of the threads and the router lead (spec 089): the object's thread, the card. */
const threadsHref: Record<string, (holding: Holding) => string> = {
  'threads:message': (h) => `/fils/${h.object.kind}/${encodeURIComponent(h.object.id)}`,
  'channels:triage': (h) => `/fils/a-classer/${encodeURIComponent(h.source.ref)}`,
};

/** An address an app gave: its own https page, or a path of the center — nothing else. */
const safe = (href: string | null) =>
  href && (href.startsWith('https://') || (href.startsWith('/') && !href.startsWith('//')))
    ? href
    : null;

export function hrefOf(holding: Holding): string {
  return (
    safe(holding.href) ??
    threadsHref[`${holding.source.app}:${holding.source.kind}`]?.(holding) ??
    (holding.source.app === APP
      ? (sourceKinds[holding.source.kind as SourceKind] ?? (() => '/'))(holding.source.ref)
      : '/')
  );
}
