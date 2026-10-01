import { index, rootRoute, route } from '@tanstack/virtual-file-routes';

// Every address of the screens, once: files are named in English, addresses read in French
// (doctrine ARCHITECTURE_APP §3).
export const routes = rootRoute('__root.tsx', [
  index('index.tsx'),
  route('/inbox', 'inbox.tsx'),
  route('/structure', 'structure.tsx'),
  route('/droits', 'rights.tsx'),
  route('/registre', 'registry.tsx'),
  route('/agents', 'agents.tsx'),
  route('/auth/connexion', 'auth/sign-in.ts'),
  route('/auth/callback', 'auth/callback.ts'),
  route('/auth/sortie', 'auth/sign-out.ts'),
  route('/health', 'api/health.ts'),
]);
