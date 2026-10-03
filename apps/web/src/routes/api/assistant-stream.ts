import { createFileRoute } from '@tanstack/react-router';
import { SignInRequired, streamApi } from '@/platform/api';
import { env } from '@/platform/env';

// The assistant's chat, streamed (spec 017): the screen posts here, the server adds the person's
// token and relays the API's lines as they come. Only this application's own pages may post.
export const Route = createFileRoute('/assistant/flux')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(env.publicUrl).origin) {
          return Response.json({ error: 'forbidden' }, { status: 403 });
        }
        const body: unknown = await request.json().catch(() => null);
        try {
          return await streamApi(request, '/v1/assistant/chat/stream', body);
        } catch (error) {
          if (error instanceof SignInRequired) {
            return Response.json({ error: 'signed_out' }, { status: 401 });
          }
          throw error;
        }
      },
    },
  },
});
