import type { SearchHit } from '@kete/knowledge';
import type { SqlExecutor } from '@kete/tenancy';

// A document of the library as a person reads it (spec 064): its pages, each made of the passages
// it was indexed in, so that a cited passage opens at its page, highlighted. Only what her
// audience opens, from a source switched on; an administrator reads every document.

export interface DocumentReading {
  documentId: string;
  title: string;
  sourceName: string;
  /** The original, when the document came from an address. */
  uri: string | null;
  pages: { page: number | null; passages: { passage: number; text: string }[] }[];
  /** More passages than are shown. */
  truncated: boolean;
}

/** The most passages a reading shows at once. */
const MAX_PASSAGES = 2000;

export async function readDocument(
  db: SqlExecutor,
  documentId: string,
  /** Her audience keys; null for an administrator, who reads everything. */
  audience: string[] | null,
): Promise<DocumentReading | null> {
  const { rows } = await db.query<{
    title: string;
    uri: string | null;
    source_name: string;
  }>(
    `select d.title, d.uri, s.name as source_name
       from kete_knowledge_documents d
       join kete_knowledge_sources s
         on s.organization_id = d.organization_id and s.source_id = d.source_id
      where d.document_id = $1
        and ($2::text[] is null or (s.enabled and s.audience && $2::text[]))`,
    [documentId, audience],
  );
  const head = rows[0];
  if (!head) return null;
  const passages = await db.query<{ ordinal: number; page: number | null; text: string }>(
    `select ordinal, page, text from kete_knowledge_chunks
      where document_id = $1 order by ordinal limit $2`,
    [documentId, MAX_PASSAGES + 1],
  );
  const pages: DocumentReading['pages'] = [];
  for (const row of passages.rows.slice(0, MAX_PASSAGES)) {
    const last = pages.at(-1);
    const entry = { passage: row.ordinal, text: row.text };
    if (last && last.page === row.page) last.passages.push(entry);
    else pages.push({ page: row.page, passages: [entry] });
  }
  return {
    documentId,
    title: head.title,
    sourceName: head.source_name,
    uri: head.uri,
    pages,
    truncated: passages.rows.length > MAX_PASSAGES,
  };
}

/** Where a found passage opens: the document in the library, at its page, the passage marked. */
export async function placesOf(
  db: SqlExecutor,
  hits: readonly SearchHit[],
): Promise<Map<SearchHit, string>> {
  const places = new Map<SearchHit, string>();
  for (const hit of hits) {
    const { rows } = await db.query<{ ordinal: number }>(
      `select ordinal from kete_knowledge_chunks where document_id = $1 and text = $2 limit 1`,
      [hit.documentId, hit.text],
    );
    const query = new URLSearchParams();
    if (hit.page !== null) query.set('page', String(hit.page));
    if (rows[0]) query.set('passage', String(rows[0].ordinal));
    const search = query.toString();
    places.set(hit, `/bibliotheque/document/${hit.documentId}${search ? `?${search}` : ''}`);
  }
  return places;
}
