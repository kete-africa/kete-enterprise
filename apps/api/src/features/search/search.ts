import { search as searchLibrary } from '@kete/knowledge';
import { Hono } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readRegister } from '../actions/index.js';
import { listConversations } from '../assistant/index.js';
import { inboxFor } from '../decisions/index.js';
import { myCard, unitCard } from '../directory/index.js';
import { knowledgeEmbedderFor, libraryOpen, readerKeys } from '../knowledge/index.js';
import { registryFor } from '../registry/index.js';
import { personOfAccount } from '../structure/index.js';

// Searching everywhere (spec 030): one question across what a person may see — her conversations,
// her actions, her decisions, the people of her units, her apps, the library. Every result comes
// from the features' own readers, so the search shows exactly what the screens show her.

export type ResultKind = 'conversation' | 'action' | 'decision' | 'person' | 'app' | 'document';

export interface SearchResult {
  kind: ResultKind;
  title: string;
  detail: string | null;
  href: string;
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Whether every word of the question is somewhere in the text, accents and case aside. */
export function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = fold(query)
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const haystack = fold(texts.filter(Boolean).join(' '));
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

const PER_KIND = 6;

/** Search, under /v1/search. */
export const searchRoutes = new Hono<{ Variables: IdentityVariables }>().get('/', async (c) => {
  const q = z.string().trim().min(2).max(200).safeParse(c.req.query('q'));
  if (!q.success) throw new GestureRefusal(422, 'invalid_input', 'Two letters at least.');
  const identity = c.get('identity');
  const query = q.data;
  const results = await transaction(identity.organizationId, async (db) => {
    const found: SearchResult[] = [];
    const add = (items: SearchResult[]) => found.push(...items.slice(0, PER_KIND));

    add(
      (await listConversations(db, identity.userId))
        .filter((x) => matches(query, x.title))
        .map((x) => ({
          kind: 'conversation',
          title: x.title,
          detail: null,
          href: `/assistant?c=${x.conversationId}`,
        })),
    );

    const person = await personOfAccount(db, identity.userId);
    if (person) {
      add(
        (await readRegister(db, { personId: person.personId }))
          .filter((a) => matches(query, a.title, a.detail))
          .map((a) => ({ kind: 'action', title: a.title, detail: a.dueOn, href: '/actions' })),
      );
    }

    const inbox = await inboxFor(db, identity);
    add(
      [...inbox.toDecide, ...inbox.mine]
        .filter((r) => matches(query, r.title))
        .map((r) => ({ kind: 'decision', title: r.title, detail: r.status, href: '/a-faire' })),
    );

    // The people of her units, her managers and her reports: whom the directory shows her.
    const card = await myCard(db, identity);
    if (card) {
      const people = new Map<string, SearchResult>();
      const consider = (name: string, detail: string | null) => {
        if (matches(query, name, detail) && !people.has(name)) {
          people.set(name, { kind: 'person', title: name, detail, href: '/mon-equipe' });
        }
      };
      [...card.managers, ...card.reports].forEach((p) => consider(p.name, null));
      for (const position of card.positions.slice(0, 5)) {
        const unit = await unitCard(db, identity, position.unitId);
        unit?.people.forEach((p) => consider(p.name, p.positionTitle));
      }
      add([...people.values()]);
    }

    add(
      (await registryFor(db, identity)).resources
        .filter((r) => r.status === 'active' && matches(query, r.name, r.description))
        .map((r) => ({
          kind: 'app',
          title: r.name,
          detail: r.description ?? null,
          href: r.address ?? '/ressources',
        })),
    );

    if (await libraryOpen(db, identity)) {
      const embedder = knowledgeEmbedderFor(identity);
      if (embedder) {
        const hits = await searchLibrary(
          db,
          { query, audience: await readerKeys(db, identity), limit: PER_KIND },
          embedder,
        );
        add(
          hits.map((h) => ({
            kind: 'document',
            title: h.page ? `${h.title} · p. ${h.page}` : h.title,
            detail: h.text.slice(0, 160),
            href: h.uri ?? `/bibliotheque?q=${encodeURIComponent(query)}`,
          })),
        );
      }
    }
    return found;
  });
  return c.json({ query, results });
});
