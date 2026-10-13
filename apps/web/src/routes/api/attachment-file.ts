import { createFileRoute } from '@tanstack/react-router';
import { fileOfApi } from '@/platform/api';

// A file of one of her conversations (spec 064), shown again in the thread through the API with
// her session: nobody else's.
export const Route = createFileRoute('/api/pieces/$attachmentId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        /^att_[0-9a-f-]{8,64}$/.test(params.attachmentId)
          ? fileOfApi(request, `/v1/assistant/attachments/${params.attachmentId}/file`)
          : new Response('Not found', { status: 404 }),
    },
  },
});
