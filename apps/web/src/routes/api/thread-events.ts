import { createFileRoute } from '@tanstack/react-router';
import { eventsOfApi } from '@/platform/api';

// Her threads, live (spec 098, FR-004): the screen listens here; the server adds her token and
// relays the API's events as they come. The screen then reads the thread again.
export const Route = createFileRoute('/api/fils/flux')({
  server: {
    handlers: {
      GET: ({ request }) => eventsOfApi(request, '/v1/threads/events'),
    },
  },
});
