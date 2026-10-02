import { index, rootRoute, route } from '@tanstack/virtual-file-routes';

// Every address of the screens, once: files are named in English, addresses read in French
// (doctrine ARCHITECTURE_APP §3). The space first, then the Administration (spec 010).
export const routes = rootRoute('__root.tsx', [
  index('index.tsx'),
  route('/a-faire', 'inbox.tsx'),
  route('/conformite', 'compliance.tsx'),
  route('/administration', 'admin-home.tsx'),
  route('/administration/organisation', 'structure.tsx'),
  route('/administration/personnes', 'people.tsx'),
  route('/administration/droits', 'rights.tsx'),
  route('/administration/modules', 'modules.tsx'),
  route('/administration/circuits', 'circuits.tsx'),
  route('/administration/registre', 'registry.tsx'),
  route('/administration/agents', 'agents.tsx'),
  route('/administration/boite-de-test', 'outbox.tsx'),
  route('/administration/demo', 'demo.tsx'),
  route('/lien/$token', 'link.tsx'),
  route('/auth/connexion', 'auth/sign-in.ts'),
  route('/auth/callback', 'auth/callback.ts'),
  route('/auth/sortie', 'auth/sign-out.ts'),
  route('/health', 'api/health.ts'),
]);
