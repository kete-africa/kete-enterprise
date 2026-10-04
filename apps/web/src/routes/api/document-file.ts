import { createFileRoute } from '@tanstack/react-router';
import { fileOfApi } from '@/platform/api';

// One of her documents (spec 038), downloaded through the API with her session: nobody else's.
export const Route = createFileRoute('/api/documents/$documentId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        /^gdoc_[0-9A-Za-z_-]{4,70}$/.test(params.documentId)
          ? fileOfApi(request, `/v1/documents/${params.documentId}`)
          : new Response('Not found', { status: 404 }),
    },
  },
});
