import { createFileRoute } from '@tanstack/react-router';
import { SignInRequired, streamApi } from '@/platform/api';
import { env } from '@/platform/env';

// An answer said aloud (spec 094): the screen posts its words here, the server adds the person's
// token and relays the audio. Only this application's own pages may post.
export const Route = createFileRoute('/assistant/voix')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(env.publicUrl).origin) {
          return Response.json({ error: 'forbidden' }, { status: 403 });
        }
        const body: unknown = await request.json().catch(() => null);
        try {
          return await streamApi(request, '/v1/assistant/speech', body);
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
