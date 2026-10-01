import { createFileRoute } from '@tanstack/react-router';

// The screens' liveness; the API reports its own health, with its database.
export const Route = createFileRoute('/health')({
  server: { handlers: { GET: () => Response.json({ status: 'healthy' }) } },
});
