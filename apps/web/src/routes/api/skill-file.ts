import { createFileRoute } from '@tanstack/react-router';
import { fileOfApi } from '@/platform/api';

// A skill exported as its .zip (spec 031), for Claude, ChatGPT or Codex, with the person's session.
export const Route = createFileRoute('/api/skills/$skillId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        /^skl_[0-9A-Za-z_-]{4,70}$/.test(params.skillId)
          ? fileOfApi(request, `/v1/skills/${params.skillId}/archive`)
          : new Response('Not found', { status: 404 }),
    },
  },
});
