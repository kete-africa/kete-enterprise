import { languageModel, modelConfigFromEnv, scanReader, type ModelConfig } from '@kete/ai';
import {
  readable,
  readDocument,
  type ReadDocument,
  type ReadKind,
  type Transcriber,
} from '@kete/files';
import { usageStore } from './usage.js';

// What a file says (specs 027, 028, 035), read by @kete/files: PDF, Word, Excel, PowerPoint,
// OpenDocument, RTF, text — page by page. A scan (an image, a PDF without text) is read by the
// organization's model when a caller asks for its text, its use journaled like any model call.

export type AttachmentKind = ReadKind;
export type Extracted = ReadDocument;
export { readable };

let override: Transcriber | null | undefined;

/** Tests: read scans another way (`null`: as if no model were configured). */
export function useTranscriber(next: Transcriber | null | undefined): void {
  override = next;
}

function organizationModel(): ModelConfig | null {
  try {
    return modelConfigFromEnv('KETE_AI');
  } catch {
    return null;
  }
}

/** Who reads a scan for this person: the organization's model, journaled as `reading`. */
export function scanReaderFor(caller: {
  organizationId: string;
  userId: string;
}): Transcriber | undefined {
  if (override !== undefined) return override ?? undefined;
  const config = organizationModel();
  if (!config) return undefined;
  return scanReader({
    model: languageModel(config),
    metering: {
      store: usageStore(),
      context: {
        organizationId: caller.organizationId,
        actor: { kind: 'person', id: caller.userId, channel: 'web' },
        purpose: 'reading',
        model: '',
      },
    },
  });
}

export async function extract(
  contentType: string,
  data: Buffer,
  options: { transcribe?: Transcriber | undefined } = {},
): Promise<Extracted> {
  return readDocument(
    contentType,
    new Uint8Array(data),
    options.transcribe ? { transcribe: options.transcribe } : {},
  );
}
