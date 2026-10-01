import { redirect } from '@tanstack/react-router';
import { fetchMe } from './me';

/** Every signed-in screen: anyone else goes through the Compte Kete first, then comes back. */
export async function requirePerson(returnTo: string) {
  const me = await fetchMe();
  if (!me) {
    throw redirect({
      href: `/auth/connexion?returnTo=${encodeURIComponent(returnTo)}`,
      reloadDocument: true,
    });
  }
  return { me };
}
