import { embeddingModel, modelConfigFromEnv, type ModelConfig } from '@kete/ai';
import { aiEmbedder, type Embedder } from '@kete/knowledge';
import { usageStore } from '../../../platform/usage.js';

// The library's embedding model (spec 028): `KETE_EMBEDDING_PROVIDER`, `KETE_EMBEDDING_MODEL` and
// the provider's usual key; without them, the organization's provider with its small embedding
// model. The provider's names stay here, in the infrastructure.

export const KNOWLEDGE_DIMENSIONS = 1536;

function config(): ModelConfig | null {
  try {
    return modelConfigFromEnv('KETE_EMBEDDING');
  } catch {
    // Not configured on its own: the organization's provider, if it offers embeddings.
  }
  try {
    const ai = modelConfigFromEnv('KETE_AI');
    if (ai.provider === 'openai') return { ...ai, model: 'text-embedding-3-small' };
    if (ai.provider === 'mistral') return { ...ai, model: 'mistral-embed' };
  } catch {
    // No model at all.
  }
  return null;
}

let override: Embedder | undefined;

/** Tests: embed another way (nothing leaves the test). */
export function useEmbedder(next: Embedder | undefined): void {
  override = next;
}

/**
 * The embedder for one person's gesture, its use journaled like any model call (purpose
 * `knowledge`); null when this instance has no embedding model.
 */
export function knowledgeEmbedder(caller: {
  organizationId: string;
  userId: string;
}): Embedder | null {
  if (override) return override;
  const c = config();
  if (!c) return null;
  const store = usageStore();
  return aiEmbedder(embeddingModel(c), {
    dimensions: KNOWLEDGE_DIMENSIONS,
    onUsage: (tokens) => {
      void store
        .record(
          {
            organizationId: caller.organizationId,
            actor: { kind: 'person', id: caller.userId, channel: 'web' },
            purpose: 'knowledge',
            model: '',
          },
          { inputTokens: tokens, outputTokens: 0, modelCalls: 1 },
        )
        .catch(() => undefined);
    },
  });
}
