import { createFileRoute } from '@tanstack/react-router';
import { getSignIn } from '@/platform/session';

// The Compte Kete sends the person back here; a replayed or tampered answer is refused.
export const Route = createFileRoute('/auth/callback')({
  server: { handlers: { GET: ({ request }) => getSignIn().callback(request) } },
});
