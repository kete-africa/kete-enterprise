import { createFileRoute } from '@tanstack/react-router';
import { fileOfApi } from '@/platform/api';

// A file of a thread (spec 098, FR-006), opened through the API with her session: only by the
// thread's members.
export const Route = createFileRoute('/api/fils/fichiers/$fileId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        /^fil_[0-9A-Za-z_-]{8,70}$/.test(params.fileId)
          ? fileOfApi(request, `/v1/threads/files/${params.fileId}`)
          : new Response('Not found', { status: 404 }),
    },
  },
});
