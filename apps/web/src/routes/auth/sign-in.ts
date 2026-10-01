import { createFileRoute } from '@tanstack/react-router';
import { getSignIn } from '@/platform/session';

/** Only a path of these screens: never an address elsewhere. */
function returnPath(request: Request): string {
  const returnTo = new URL(request.url).searchParams.get('returnTo') ?? '';
  return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
}

// Sends the person to the Compte Kete to sign in, then back where she was going.
export const Route = createFileRoute('/auth/connexion')({
  server: {
    handlers: {
      GET: ({ request }) => getSignIn().start(request, { returnTo: returnPath(request) }),
    },
  },
});
