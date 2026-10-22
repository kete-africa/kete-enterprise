import { diskStorage, s3Storage, type ObjectStorage } from '@kete/files';
import { resolve } from 'node:path';

// Where the files of the threads are kept (spec 099, FR-004; kete-core spec 140): an S3-compatible
// bucket when the instance has one (`KETE_STORAGE_*`), else the server's disk (`KETE_FILES_DIR`,
// `.data/files` by default) — a single server, or development. The provider is named only here.

let override: ObjectStorage | null | undefined;

/** Tests: another storage (`null`: none, the files stay in the database). */
export function useFileStorage(next: ObjectStorage | null | undefined): void {
  override = next;
}

let made: ObjectStorage | undefined;

/** The instance's storage for the threads' files. */
export function fileStorage(): ObjectStorage | null {
  if (override !== undefined) return override;
  if (made) return made;
  const endpoint = process.env.KETE_STORAGE_ENDPOINT;
  const accessKeyId = process.env.KETE_STORAGE_ACCESS_KEY_ID;
  made =
    endpoint && accessKeyId
      ? s3Storage({
          endpoint,
          region: process.env.KETE_STORAGE_REGION ?? 'auto',
          bucket: process.env.KETE_STORAGE_BUCKET ?? 'kete-enterprise',
          accessKeyId,
          secretAccessKey: process.env.KETE_STORAGE_SECRET_ACCESS_KEY ?? '',
        })
      : diskStorage(resolve(process.env.KETE_FILES_DIR ?? '.data/files'));
  return made;
}
