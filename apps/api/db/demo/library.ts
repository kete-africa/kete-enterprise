import type { Embedder } from '@kete/knowledge';
import type { Hono } from 'hono';
import { useEmbedder } from '../../src/features/knowledge/index.js';

// The demo's library (step C4): one report of the after-sales service, indexed with an embedder
// written in advance — words hashed, no model called — so that a search finds it and a cited
// passage opens at its place.

const hashed: Embedder = {
  dimensions: 1536,
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Array<number>(1536).fill(0);
      for (const word of text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\W+/)) {
        if (word.length < 3) continue;
        let h = 0;
        for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        vector[h % 1536] = (vector[h % 1536] ?? 0) + 1;
      }
      const norm = Math.hypot(...vector) || 1;
      return vector.map((x) => x / norm);
    });
  },
};

const REPORT = [
  'Rapport de visite — site d’Agoè, 3 octobre 2026.',
  'Le technicien a contrôlé les onduleurs, les panneaux et le parc de batteries.',
  'Les batteries du site sont en fin de vie : il reste deux à trois semaines d’autonomie. Leur remplacement est à prévoir avant la fin du mois.',
  'Les onduleurs fonctionnent normalement. Un panneau est fêlé sur la rangée nord ; il ne perd que 4 % de production.',
  'Prochaine visite : après le remplacement des batteries.',
].join('\n\n');

export async function seedLibrary(options: { api: Hono; admin: string }): Promise<boolean> {
  useEmbedder(hashed);
  const call = async (method: 'POST', path: string, body: object) => {
    const response = await options.api.request(`/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.admin}`,
        'content-type': 'application/json',
        'idempotency-key': `demo-library-${Date.now()}-${Math.random()}`,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  await call('POST', '/organization/modules', { module: 'knowledge', enabled: true });
  const source = await call('POST', '/knowledge/sources', {
    name: 'Rapports SAV',
    audience: ['everyone'],
  });
  const sourceId = (source.body.source as { sourceId?: string } | undefined)?.sourceId;
  if (!sourceId) return false;
  const indexed = await call('POST', `/knowledge/sources/${sourceId}/documents`, {
    name: 'Rapport de visite Agoè.txt',
    contentType: 'text/plain',
    data: Buffer.from(REPORT, 'utf8').toString('base64'),
  });
  return indexed.status === 201;
}
