import { createKeteSignIn, type KeteSignIn } from '@kete/auth';
import { env } from './env';

let signIn: KeteSignIn | undefined;

/**
 * People sign in with their Compte Kete; the screens keep no password. The session keeps the
 * person's token, server-side only, to call the API on her behalf: never more than her rights.
 */
export function getSignIn(): KeteSignIn {
  signIn ??= createKeteSignIn({
    accountUrl: env.accountUrl,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: `${env.publicUrl}/auth/callback`,
    sessionSecret: env.sessionSecret,
    keepAccessToken: true,
  });
  return signIn;
}
