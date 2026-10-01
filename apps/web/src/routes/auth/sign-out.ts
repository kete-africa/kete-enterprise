import { createFileRoute } from '@tanstack/react-router';
import { getSignIn } from '@/platform/session';

// Closes this app's session; the Compte Kete's stays, so signing in again is silent.
export const Route = createFileRoute('/auth/sortie')({
  server: { handlers: { GET: () => getSignIn().signOut('/') } },
});
