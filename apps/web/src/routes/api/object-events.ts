import { createFileRoute } from '@tanstack/react-router';
import { eventsOfApi } from '@/platform/api';

// One object, live (spec 101, FR-008): the screen open on it listens here; the server adds her
// token and relays the API's stream. The screen then reads the object again.
export const Route = createFileRoute('/api/objets/$kind/$id/flux')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const { kind, id } = params as { kind: string; id: string };
        if (
          !/^[a-z][a-z0-9_]{1,40}$/.test(kind) ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)
        ) {
          return new Response(null, { status: 404 });
        }
        return eventsOfApi(request, `/v1/objects/${kind}/${encodeURIComponent(id)}/live`);
      },
    },
  },
});
