import type { CapabilityTool } from '@kete/capabilities';
import {
  audienceKey,
  createSource,
  getSource,
  indexDocument,
  KnowledgeError,
  knowledgeMigrationSql,
  listDocuments,
  listSources,
  removeDocument,
  removeSource,
  search,
  updateSource,
  type SearchHit,
} from '@kete/knowledge';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { extract, readable, scanReaderFor } from '../../platform/extract.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { myCard } from '../directory/index.js';
import { readModules, requireModule } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import { readChartAt } from '../structure/index.js';
import { KNOWLEDGE_DIMENSIONS, knowledgeEmbedder } from './infrastructure/embedder.js';

// The company's library (spec 028), on @kete/knowledge: sources an administrator switches on or
// off and opens to everyone, to units (with their sub-units) or to administrators; documents read
// page by page and searched with their citations — each person finds only what she may read.

type Identity = IdentityVariables['identity'];
type Ctx = Context<{ Variables: IdentityVariables }>;

export function knowledgeTablesSql(options: { schema: string; appRole: string }): string {
  return knowledgeMigrationSql({ ...options, dimensions: KNOWLEDGE_DIMENSIONS });
}

/** The units a person belongs to through her positions, with all the units above them. */
export function unitKeys(
  own: string[],
  units: { unitId: string; parentId: string | null }[],
): string[] {
  const parent = new Map(units.map((u) => [u.unitId, u.parentId]));
  const keys = new Set<string>();
  for (const id of own) {
    let current: string | null | undefined = id;
    for (let depth = 0; current && depth < 50 && !keys.has(`unit:${current}`); depth++) {
      keys.add(`unit:${current}`);
      current = parent.get(current);
    }
  }
  return [...keys];
}

/**
 * Whom a person reads as: everyone, herself, the units she holds a position in (and those above
 * them, so that a document opened to the SAV is read by its teams), administrators.
 */
export async function readerKeys(db: SqlExecutor, identity: Identity): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [card, chart] = await Promise.all([myCard(db, identity, today), readChartAt(db, today)]);
  const own = (card?.positions ?? []).map((p) => p.unitId);
  const more = (
    await Promise.all(readerKeyProviders.map((provide) => provide(db, identity)))
  ).flat();
  return [
    'everyone',
    `user:${identity.userId}`,
    ...(isAdministrator(identity) ? ['role:admin'] : []),
    ...unitKeys(own, chart.units),
    ...more,
  ];
}

/** Other features open sources to their own audiences: a dossier to its members (spec 034). */
export type ReaderKeyProvider = (db: SqlExecutor, identity: Identity) => Promise<string[]>;
const readerKeyProviders: ReaderKeyProvider[] = [];

export function addReaderKeys(provider: ReaderKeyProvider): void {
  if (!readerKeyProviders.includes(provider)) readerKeyProviders.push(provider);
}

/** An audience as an administrator sets it: everyone, units, administrators, people. */
const audience = z
  .array(audienceKey.refine((k) => /^(everyone|role:admin|unit:.+|user:.+)$/.test(k)))
  .min(1)
  .max(100);

const sourceBody = z.object({
  name: z.string().trim().min(1).max(200),
  audience: audience.default(['everyone']),
  enabled: z.boolean().default(true),
});
const sourceChange = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  audience: audience.optional(),
  enabled: z.boolean().optional(),
});

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const documentBody = z.object({
  name: z.string().trim().min(1).max(300),
  contentType: z.string().min(3).max(120),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 8),
  uri: z.string().url().startsWith('https://').optional(),
});

function admin(c: Ctx): Identity {
  const identity = c.get('identity');
  if (!isAdministrator(identity) || c.get('viewedBy')) {
    throw new GestureRefusal(403, 'forbidden', 'Administrators set the library.');
  }
  return identity;
}

function embedderFor(identity: Identity) {
  const embedder = knowledgeEmbedder(identity);
  if (!embedder) {
    throw new GestureRefusal(409, 'knowledge_unavailable', 'No embedding model is configured.');
  }
  return embedder;
}

const label = (h: SearchHit) => (h.page ? `${h.title} · p. ${h.page}` : h.title);
const hrefOf = (h: SearchHit) => h.uri ?? `/bibliotheque?document=${h.documentId}`;

/** The library, under /v1/knowledge. */
export const knowledgeRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('knowledge'))
  // The sources: all of them for an administrator, those she may read for anyone else.
  .get('/sources', async (c) => {
    const identity = c.get('identity');
    const manage = isAdministrator(identity) && !c.get('viewedBy');
    const sources = await transaction(identity.organizationId, async (db) =>
      manage ? listSources(db) : listSources(db, { audience: await readerKeys(db, identity) }),
    );
    return c.json({ manage, sources });
  })
  .post('/sources', async (c) => {
    const identity = admin(c);
    const parsed = sourceBody.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A name, an audience.');
    const source = await transaction(identity.organizationId, (db) =>
      createSource(db, identity.organizationId, parsed.data),
    );
    return c.json({ source }, 201);
  })
  .post('/sources/:sourceId', async (c) => {
    const identity = admin(c);
    const parsed = sourceChange.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What changes?');
    const change = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as { name?: string; audience?: string[]; enabled?: boolean };
    const source = await transaction(identity.organizationId, (db) =>
      updateSource(db, c.req.param('sourceId'), change),
    );
    if (!source) throw new GestureRefusal(404, 'not_found', 'No such source.');
    return c.json({ source }, 201);
  })
  .post('/sources/:sourceId/remove', async (c) => {
    const identity = admin(c);
    const removed = await transaction(identity.organizationId, (db) =>
      removeSource(db, c.req.param('sourceId')),
    );
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such source.');
    return c.json({ removed });
  })
  .get('/sources/:sourceId/documents', async (c) => {
    const identity = admin(c);
    const documents = await transaction(identity.organizationId, (db) =>
      listDocuments(db, c.req.param('sourceId')),
    );
    return c.json({ documents });
  })
  // A document read page by page, indexed in its source.
  .post('/sources/:sourceId/documents', async (c) => {
    const identity = admin(c);
    const parsed = documentBody.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A document, in base64.');
    const data = Buffer.from(parsed.data.data, 'base64');
    if (data.length > MAX_DOCUMENT_BYTES) {
      throw new GestureRefusal(422, 'file_too_large', 'Twenty megabytes at most.');
    }
    if (!readable(parsed.data.contentType)) {
      throw new GestureRefusal(422, 'unsupported_file', 'PDF, Word or text.');
    }
    const read = await extract(parsed.data.contentType, data, {
      transcribe: scanReaderFor(c.get('identity')),
    }).catch(() => null);
    if (!read || read.kind !== 'text' || !read.text) {
      throw new GestureRefusal(422, 'unreadable_file', 'No text could be read.');
    }
    const embedder = embedderFor(identity);
    const sourceId = c.req.param('sourceId');
    try {
      const indexed = await transaction(identity.organizationId, async (db) => {
        if (!(await getSource(db, sourceId))) {
          throw new GestureRefusal(404, 'not_found', 'No such source.');
        }
        return indexDocument(
          db,
          {
            organizationId: identity.organizationId,
            sourceId,
            title: parsed.data.name.replace(/\.(pdf|docx|txt|md|csv|json)$/i, ''),
            uri: parsed.data.uri ?? null,
            pages: read.pageTexts,
          },
          embedder,
        );
      });
      return c.json(indexed, 201);
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'empty') {
        throw new GestureRefusal(422, 'unreadable_file', 'No text could be read.');
      }
      throw error;
    }
  })
  .post('/documents/:documentId/remove', async (c) => {
    const identity = admin(c);
    const removed = await transaction(identity.organizationId, (db) =>
      removeDocument(db, c.req.param('documentId')),
    );
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such document.');
    return c.json({ removed });
  })
  // A search, in what she may read, each passage with its citation.
  .get('/search', async (c) => {
    const identity = c.get('identity');
    const q = z.string().trim().min(2).max(500).safeParse(c.req.query('q'));
    if (!q.success) throw new GestureRefusal(422, 'invalid_input', 'A question.');
    const embedder = embedderFor(identity);
    const hits = await transaction(identity.organizationId, async (db) =>
      search(db, { query: q.data, audience: await readerKeys(db, identity), limit: 10 }, embedder),
    );
    return c.json({
      hits: hits.map((h) => ({ ...h, label: label(h), href: hrefOf(h) })),
    });
  });

/** Whether the library answers here: its module on, and an embedding model configured. */
export async function libraryOpen(db: SqlExecutor, identity: Identity): Promise<boolean> {
  return (await readModules(db)).knowledge && knowledgeEmbedder(identity) !== null;
}

const toolInput = z.object({
  query: z.string().min(2).max(500).describe('La question, avec ses mots-clés.'),
});

/**
 * The assistant's tool (level 1): the company's documents she may read, each passage with its
 * title, page and link, so that the answer cites them.
 */
export function knowledgeTool(identity: Identity): CapabilityTool {
  return {
    name: 'knowledge_search',
    description:
      'Cherche dans la bibliothèque de l’entreprise (procédures, notes, modèles, rapports) ce que la personne peut lire. Cite toujours le document et la page des passages utilisés.',
    input: toolInput,
    jsonSchema: z.toJSONSchema(toolInput) as Record<string, unknown>,
    autonomy: 1,
    async execute(input) {
      const parsed = toolInput.safeParse(input);
      const embedder = knowledgeEmbedder(identity);
      if (!parsed.success || !embedder) return { status: 'refused', reason: 'invalid_input' };
      const hits = await transaction(identity.organizationId, async (db) =>
        search(
          db,
          { query: parsed.data.query, audience: await readerKeys(db, identity), limit: 6 },
          embedder,
        ),
      );
      return {
        status: 'done',
        output: {
          passages: hits.map((h) => ({
            title: label(h),
            href: hrefOf(h),
            source: h.sourceName,
            text: h.text,
          })),
        },
      };
    },
  };
}
