import {
  createSource,
  indexDocument,
  KnowledgeError,
  listDocuments,
  removeDocument,
  search,
  updateSource,
} from '@kete/knowledge';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { extract, readable } from '../../platform/extract.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readConversationOf } from '../assistant/index.js';
import { addReaderKeys, knowledgeEmbedderFor } from '../knowledge/index.js';
import { requireModule } from '../organization/index.js';
import {
  addLink,
  addMember,
  dossierInput,
  dossierKeys,
  dossiersOf,
  getDossier,
  insertDossier,
  linkInput,
  linksOf,
  membersOf,
  newDossierId,
  removeLink,
  removeMember,
  setArchived,
  type Dossier,
} from './dossiers.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

let listening = false;

/** A dossier's documents are read by its members: their keys join the library's (spec 028). */
export function listenForDossiers(): void {
  if (listening) return;
  listening = true;
  addReaderKeys((db, identity) => dossierKeys(db, identity.userId));
}

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** The dossier, if she is a member; as the owner when asked. */
async function memberOf(
  db: SqlExecutor,
  c: Ctx,
  options: { owner?: boolean } = {},
): Promise<Dossier> {
  const dossier = await getDossier(db, c.req.param('dossierId') ?? '', c.get('identity').userId);
  if (!dossier || !dossier.role)
    throw new GestureRefusal(404, 'not_found', 'No such dossier for her.');
  if (options.owner && dossier.role !== 'owner') {
    throw new GestureRefusal(403, 'forbidden', 'Its owner decides.');
  }
  return dossier;
}

function embedderFor(identity: Identity) {
  const embedder = knowledgeEmbedderFor(identity);
  if (!embedder) {
    throw new GestureRefusal(409, 'knowledge_unavailable', 'No embedding model is configured.');
  }
  return embedder;
}

/** Dossiers, under /v1/dossiers. */
export const dossierRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('dossiers'))
  .get('/', async (c) => {
    const { organizationId, userId } = c.get('identity');
    return c.json({ dossiers: await transaction(organizationId, (db) => dossiersOf(db, userId)) });
  })
  // Anyone opens a dossier and owns it; its documents form a library source open to its members.
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to open.');
    const parsed = dossierInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A name.');
    const identity = c.get('identity');
    const dossier = await transaction(identity.organizationId, async (db) => {
      const dossierId = newDossierId();
      const source = await createSource(db, identity.organizationId, {
        name: parsed.data.name,
        kind: 'dossier',
        audience: [`dossier:${dossierId}`],
      });
      await insertDossier(db, {
        organizationId: identity.organizationId,
        dossierId,
        sourceId: source.sourceId,
        owner: { userId: identity.userId, name: identity.name },
        name: parsed.data.name,
        description: parsed.data.description,
      });
      return getDossier(db, dossierId, identity.userId);
    });
    return c.json({ dossier }, 201);
  })
  .get('/:dossierId', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const dossier = await memberOf(db, c);
        return {
          dossier,
          members: await membersOf(db, dossier.dossierId),
          links: await linksOf(db, dossier.dossierId),
          documents: await listDocuments(db, dossier.sourceId),
        };
      }),
    );
  })
  .post('/:dossierId', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        archived: z.boolean().optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What changes?');
    const identity = c.get('identity');
    const dossier = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c, { owner: true });
      if (parsed.data.name) {
        await db.query(`update dossiers set name = $2 where dossier_id = $1`, [
          d.dossierId,
          parsed.data.name,
        ]);
        await updateSource(db, d.sourceId, { name: parsed.data.name });
      }
      if (parsed.data.archived !== undefined)
        await setArchived(db, d.dossierId, parsed.data.archived);
      return getDossier(db, d.dossierId, identity.userId);
    });
    return c.json({ dossier }, 201);
  })
  .post('/:dossierId/members', async (c) => {
    const parsed = z
      .object({ userId: z.string().min(3).max(80), name: z.string().trim().min(1).max(200) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Whom?');
    const identity = c.get('identity');
    const members = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c, { owner: true });
      await addMember(db, identity.organizationId, d.dossierId, { ...parsed.data, role: 'member' });
      return membersOf(db, d.dossierId);
    });
    return c.json({ members }, 201);
  })
  .post('/:dossierId/members/:userId/remove', async (c) => {
    const identity = c.get('identity');
    const members = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c, { owner: c.req.param('userId') !== identity.userId });
      if (!(await removeMember(db, d.dossierId, c.req.param('userId')))) {
        throw new GestureRefusal(404, 'not_found', 'No such member, or its owner.');
      }
      return membersOf(db, d.dossierId);
    });
    return c.json({ members });
  })
  // What the dossier gathers, by reference: a conversation of hers, an action, a decision, an app.
  .post('/:dossierId/links', async (c) => {
    const parsed = linkInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A link.');
    const identity = c.get('identity');
    const linkId = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c);
      if (
        parsed.data.kind === 'conversation' &&
        !(await readConversationOf(db, parsed.data.ref, identity.userId))
      ) {
        throw new GestureRefusal(403, 'forbidden', 'Only her own conversations.');
      }
      return addLink(db, identity.organizationId, d.dossierId, identity.userId, parsed.data);
    });
    return c.json({ linkId }, 201);
  })
  .post('/:dossierId/links/:linkId/remove', async (c) => {
    const identity = c.get('identity');
    const removed = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c);
      return removeLink(db, d.dossierId, c.req.param('linkId'));
    });
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such link.');
    return c.json({ removed });
  })
  // A conversation ranged in the dossier, read by its members.
  .get('/:dossierId/conversations/:conversationId', async (c) => {
    const identity = c.get('identity');
    const conversation = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c);
      const id = c.req.param('conversationId');
      if (
        !(await linksOf(db, d.dossierId)).some((l) => l.kind === 'conversation' && l.ref === id)
      ) {
        throw new GestureRefusal(404, 'not_found', 'Not in this dossier.');
      }
      return readConversationOf(db, id);
    });
    if (!conversation) throw new GestureRefusal(404, 'not_found', 'No such conversation.');
    return c.json(conversation);
  })
  .post('/:dossierId/documents', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(300),
        contentType: z.string().min(3).max(120),
        data: z.string().min(1),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A document, in base64.');
    const data = Buffer.from(parsed.data.data, 'base64');
    if (data.length > MAX_DOCUMENT_BYTES)
      throw new GestureRefusal(422, 'file_too_large', '20 MB at most.');
    if (!readable(parsed.data.contentType))
      throw new GestureRefusal(422, 'unsupported_file', 'PDF, Word or text.');
    const read = await extract(parsed.data.contentType, data).catch(() => null);
    if (!read || read.kind !== 'text' || !read.text)
      throw new GestureRefusal(422, 'unreadable_file', 'No text.');
    const identity = c.get('identity');
    const embedder = embedderFor(identity);
    try {
      const indexed = await transaction(identity.organizationId, async (db) => {
        const d = await memberOf(db, c);
        return indexDocument(
          db,
          {
            organizationId: identity.organizationId,
            sourceId: d.sourceId,
            title: parsed.data.name.replace(/\.(pdf|docx|txt|md|csv|json)$/i, ''),
            pages: read.pageTexts,
          },
          embedder,
        );
      });
      return c.json(indexed, 201);
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === 'empty') {
        throw new GestureRefusal(422, 'unreadable_file', 'No text.');
      }
      throw error;
    }
  })
  .post('/:dossierId/documents/:documentId/remove', async (c) => {
    const identity = c.get('identity');
    const removed = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c);
      const known = (await listDocuments(db, d.sourceId)).some(
        (x) => x.documentId === c.req.param('documentId'),
      );
      return known && removeDocument(db, c.req.param('documentId'));
    });
    if (!removed) throw new GestureRefusal(404, 'not_found', 'No such document here.');
    return c.json({ removed });
  })
  // A search in the dossier's documents only.
  .get('/:dossierId/search', async (c) => {
    const q = z.string().trim().min(2).max(500).safeParse(c.req.query('q'));
    if (!q.success) throw new GestureRefusal(422, 'invalid_input', 'A question.');
    const identity = c.get('identity');
    const embedder = embedderFor(identity);
    const hits = await transaction(identity.organizationId, async (db) => {
      const d = await memberOf(db, c);
      return search(
        db,
        { query: q.data, audience: [`dossier:${d.dossierId}`], limit: 10 },
        embedder,
      );
    });
    return c.json({
      hits: hits.map((h) => ({ ...h, label: h.page ? `${h.title} · p. ${h.page}` : h.title })),
    });
  });
