import { languageModel, modelConfigFromEnv, transcriptionModel, type ModelConfig } from '@kete/ai';
import type { LanguageModel, TranscriptionModel } from 'ai';

// The organization's models for the features' own work — preparing a meeting's record,
// transcribing its audio (spec 035) — chosen by configuration (`KETE_AI_*`,
// `KETE_TRANSCRIPTION_*`), never in code. The provider's names stay here.

let languageOverride: LanguageModel | null | undefined;
let transcriptionOverride: TranscriptionModel | null | undefined;

/** Tests: another model (`null`: as if none were configured). */
export function useOrganizationModels(next: {
  language?: LanguageModel | null | undefined;
  transcription?: TranscriptionModel | null | undefined;
}): void {
  languageOverride = next.language;
  transcriptionOverride = next.transcription;
}

function config(prefix: string): ModelConfig | null {
  try {
    return modelConfigFromEnv(prefix);
  } catch {
    return null;
  }
}

/** The organization's language model, or null when none is configured. */
export function organizationLanguageModel(): LanguageModel | null {
  if (languageOverride !== undefined) return languageOverride;
  const c = config('KETE_AI');
  return c ? languageModel(c) : null;
}

/**
 * The transcription model: `KETE_TRANSCRIPTION_*`, or the organization's provider with its
 * transcription model when it offers one; null otherwise.
 */
export function organizationTranscriptionModel(): TranscriptionModel | null {
  if (transcriptionOverride !== undefined) return transcriptionOverride;
  const own = config('KETE_TRANSCRIPTION');
  if (own) return transcriptionModel(own);
  const ai = config('KETE_AI');
  if (ai?.provider === 'openai') return transcriptionModel({ ...ai, model: 'gpt-4o-transcribe' });
  return null;
}
