import type { Metering } from '@kete/ai';
import { transcribe } from 'ai';
import { organizationTranscriptionModel } from './models.js';

// What was said, as text: a meeting's recording (spec 035), a report dictated in the field
// (spec 059). The audio is read once and never kept; the use of the model is counted.

/** No transcription model is configured for the organization. */
export class TranscriptionUnavailable extends Error {
  constructor() {
    super('No transcription model.');
    this.name = 'TranscriptionUnavailable';
  }
}

/** A recording, as the transcription model reads it. */
export async function transcribeAudio(
  audio: Uint8Array,
  metering: Metering,
): Promise<{ text: string; language: string | null }> {
  const model = organizationTranscriptionModel();
  if (!model) throw new TranscriptionUnavailable();
  await metering.store.check(metering.context);
  const result = await transcribe({ model, audio });
  await metering.store.record(
    {
      ...metering.context,
      model: typeof model === 'string' ? model : `${model.provider}:${model.modelId}`,
    },
    { inputTokens: 0, outputTokens: 0, modelCalls: 1 },
  );
  return { text: result.text.trim(), language: result.language ?? null };
}
