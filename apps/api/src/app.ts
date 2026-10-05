import { healthHandler, manifestHandler } from '@kete/sdk';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { agentsPermissions, agentsRoutes } from './features/agents/index.js';
import { aiRoutes } from './features/ai/index.js';
import { assistantRoutes, memoryRoutes, scheduleRoutes } from './features/assistant/index.js';
import { dashboardRoutes } from './features/dashboards/index.js';
import { datasetRoutes } from './features/datasets/index.js';
import { documentRoutes } from './features/documents/index.js';
import { formRoutes, formsPublicRoutes, listenForForms } from './features/forms/index.js';
import { skillRoutes } from './features/skills/index.js';
import { dossierRoutes, listenForDossiers } from './features/dossiers/index.js';
import { knowledgeRoutes } from './features/knowledge/index.js';
import { listenForNotifications, notificationRoutes } from './features/notifications/index.js';
import { searchRoutes } from './features/search/index.js';
import { compliancePermissions, complianceRoutes } from './features/compliance/index.js';
import { decisionsPermissions, decisionsRoutes } from './features/decisions/index.js';
import {
  gatewayResourceMetadata,
  gatewayRoutes,
  handleGateway,
  viewRoutes,
  viewSandbox,
} from './features/gateway/index.js';
import { mailRoutes } from './features/mail/index.js';
import { actionsRoutes, meetingsPermissions, meetingsRoutes } from './features/meetings/index.js';
import {
  organizationRoutes,
  readModules,
  readSettings,
  requireModule,
} from './features/organization/index.js';
import { passRoutes } from './features/passes/index.js';
import {
  performancePermissions,
  performancePublicRoutes,
  performanceRoutes,
} from './features/performance/index.js';
import { registryFor, registryPermissions, registryRoutes } from './features/registry/index.js';
import {
  isAdministrator,
  reach,
  reachesAnything,
  rightsPermissions,
  rightsRoutes,
} from './features/rights/index.js';
import {
  findPerson,
  linkAccountByEmail,
  personOfAccount,
  structurePermissions,
  structureRoutes,
  unlinkedPeopleWithEmail,
} from './features/structure/index.js';
import {
  surveysPermissions,
  surveysPublicRoutes,
  surveysRoutes,
} from './features/surveys/index.js';
import { transaction } from './platform/db.js';
import { GestureRefusal, runCommand } from './platform/gestures.js';
import { requirePerson, type IdentityVariables } from './platform/identity.js';
import { health, manifest } from './platform/service.js';
import { appTasksRoutes, factsFor, todayFor, waitingCount } from './features/workspace/index.js';
import { appRequestRoutes, factoryReportRoutes } from './features/app-requests/index.js';
import { appEventRoutes, appPermissions, appRoutes, tellAppsWith } from './features/apps/index.js';
import { directoryRoutes } from './features/directory/index.js';

/** Every permission a role may allow: each feature declares its own (spec 003). */
export const permissionCatalog = [
  ...structurePermissions,
  ...rightsPermissions,
  ...registryPermissions,
  ...decisionsPermissions,
  ...agentsPermissions,
  ...compliancePermissions,
  ...surveysPermissions,
  ...performancePermissions,
  ...meetingsPermissions,
];

type Ctx = Context<{ Variables: IdentityVariables }>;

/**
 * « View as » (spec 010): in a demo organization only, an administrator sees and acts in another
 * person's space with that person's rights — never more. Elsewhere the header is refused.
 */
const viewAs: MiddlewareHandler<{ Variables: IdentityVariables }> = async (c, next) => {
  const target = c.req.header('kete-view-as');
  if (!target) return next();
  const identity = c.get('identity');
  if (!isAdministrator(identity)) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only administrators view as someone.');
  }
  const { demo, person } = await transaction(identity.organizationId, async (db) => ({
    demo: (await readSettings(db)).demo,
    person: await findPerson(db, target),
  }));
  if (!demo) {
    throw new GestureRefusal(403, 'view_as_forbidden', 'Only a demo organization allows it.');
  }
  if (!person?.accountUserId) {
    throw new GestureRefusal(404, 'not_found', 'This person has no account to view as.');
  }
  c.set('viewedBy', identity.userId);
  c.set('identity', {
    ...identity,
    userId: person.accountUserId,
    name: person.name,
    email: person.email ?? identity.email,
    role: 'member',
  });
  return next();
};

/**
 * Who is calling, as the screens need it first: her person in the organization (found by e-mail on
 * her first sign-in), what she may do anywhere, and which modules are on.
 */
async function me(c: Ctx) {
  const identity = c.get('identity');
  const { organizationId, userId } = identity;
  const viewedBy = c.get('viewedBy') ?? null;
  if (!viewedBy && identity.email) {
    const linked = await transaction(organizationId, (db) => personOfAccount(db, userId));
    if (!linked) {
      const candidates = await transaction(organizationId, (db) =>
        unlinkedPeopleWithEmail(db, identity.email),
      );
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (candidate) {
        await runCommand(
          organizationId,
          { kind: 'person', id: userId, channel: 'web' },
          `link-account:${userId}:${candidate.personId}`,
          linkAccountByEmail,
          { accountUserId: userId, email: identity.email },
        );
      }
    }
  }
  return transaction(organizationId, async (db) => {
    const person = await personOfAccount(db, userId);
    const held: string[] = [];
    for (const permission of permissionCatalog) {
      if (reachesAnything(await reach(db, identity, permission))) held.push(permission);
    }
    return {
      userId,
      name: identity.name,
      email: identity.email,
      organizationId,
      role: identity.role,
      personId: person?.personId ?? null,
      administrator: isAdministrator(identity),
      permissions: held,
      modules: await readModules(db),
      demo: (await readSettings(db)).demo,
      viewedBy,
      // The team's apps in her sidebar: the active apps of the registry she may see (spec 016).
      apps: (await registryFor(db, identity)).resources
        .filter((r) => r.kind === 'app' && r.status === 'active' && r.address)
        .map((r) => ({ resourceId: r.resourceId, name: r.name, address: r.address })),
      // What waits for her: the count beside « À faire » (spec 046).
      waiting: await waitingCount(db, identity),
    };
  });
}

/**
 * The API (doctrine D-029): framework-free building blocks from kete-core (`Request → Response`),
 * served by Hono. Each feature adds its routes under /v1, behind a person's token; personal links
 * open their own routes under /public, without an account (spec 010).
 */
// An app that asked a decision is told once it is decided (spec 023).
tellAppsWith(transaction);
// The people a request waits for are told (spec 030).
listenForNotifications();
// A dossier's documents are read by its members (spec 034).
listenForDossiers();
// Each form is a subject of the decisions engine (spec 032).
listenForForms();

export function createApi(): Hono {
  const api = new Hono();
  api.get('/health', () => healthHandler(health)());
  api.get('/.well-known/kete', () => manifestHandler(manifest())());
  // The MCP gateway checks its own token, and tells copilots where to get one (spec 006).
  api.all('/mcp', (c) => handleGateway(c.req.raw));
  api.get('/.well-known/oauth-protected-resource', (c) => gatewayResourceMetadata(c.req.raw));
  // The apps' views run here, on another origin than the screens (spec 030, MCP Apps).
  api.get('/views/sandbox', () => viewSandbox());

  const v1 = new Hono<{ Variables: IdentityVariables }>();
  v1.use('*', requirePerson);
  v1.use('*', viewAs);
  v1.get('/me', async (c) => c.json(await me(c)));
  v1.route('/organization', organizationRoutes);
  v1.route('/structure', structureRoutes);
  v1.route('/rights', rightsRoutes(permissionCatalog, appPermissions));
  // The organization as the team's apps read it, with the person's token (spec 023).
  v1.route('/directory', directoryRoutes);
  v1.route('/registry', registryRoutes);
  v1.route('/decisions', decisionsRoutes);
  v1.route('/gateway', gatewayRoutes);
  v1.use('/agents', requireModule('agents'));
  v1.use('/agents/*', requireModule('agents'));
  v1.route('/agents', agentsRoutes(permissionCatalog));
  v1.use('/compliance', requireModule('compliance'));
  v1.use('/compliance/*', requireModule('compliance'));
  v1.route('/compliance', complianceRoutes);
  v1.route('/mail', mailRoutes);
  v1.route('/surveys', surveysRoutes);
  v1.route('/performance', performanceRoutes);
  v1.route('/meetings', meetingsRoutes);
  v1.route('/actions', actionsRoutes);
  // Her scheduled tasks: her morning briefing, her questions at a set time (spec 029).
  v1.route('/assistant/schedules', scheduleRoutes);
  // What her assistant remembers about her, shown and forgotten on demand (spec 029).
  v1.route('/assistant/memories', memoryRoutes);
  // The team's apps' views in the chat: their pages, the calls they make (spec 030).
  v1.route('/views', viewRoutes);
  // The company's library, searched with its citations (spec 028).
  v1.route('/knowledge', knowledgeRoutes);
  // What she is told, and on which devices (spec 030).
  v1.route('/notifications', notificationRoutes);
  // One question across what she may see (spec 030).
  v1.route('/search', searchRoutes);
  // One space per subject (spec 034).
  v1.route('/dossiers', dossierRoutes);
  // The organization's templates and each person's documents (spec 038).
  v1.route('/documents', documentRoutes);
  // A team's data, its tables summed up (spec 031).
  v1.route('/datasets', datasetRoutes);
  // Forms, their answers through a circuit, read as data (spec 032).
  v1.route('/forms', formRoutes);
  // Dashboards, read with each reader's rights (spec 033).
  v1.route('/dashboards', dashboardRoutes);
  // The organization's know-how, as skills (spec 031).
  v1.route('/skills', skillRoutes);
  v1.route('/assistant', assistantRoutes);
  // Each person's own AI connection, and the organization's policy (spec 026).
  v1.route('/ai', aiRoutes);
  // What the team's apps ask with the person's token: her grants for one app (spec 022).
  v1.route('/apps', appRoutes);
  // Tasks the team's apps put in a person's To do, with her own token (spec 018).
  v1.route('/workspace/tasks', appTasksRoutes);
  // A person asks for an app, IT decides, the factory creates it (spec 021).
  v1.route('/app-requests', appRequestRoutes);
  // What waits for the person, and where she stands: the home page reads it (spec 014).
  v1.get('/workspace', async (c) => {
    const identity = c.get('identity');
    return c.json(await transaction(identity.organizationId, (db) => factsFor(db, identity)));
  });
  // « Aujourd'hui »: what to do, the views she pinned, what her agents did (spec 046).
  v1.get('/today', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await todayFor(identity, {
        admin: isAdministrator(identity) && !c.get('viewedBy'),
        viewedBy: c.get('viewedBy') ?? null,
      }),
    );
  });
  api.route('/v1', v1);

  const open = new Hono();
  open.route('/passes', passRoutes);
  open.route('/surveys', surveysPublicRoutes);
  open.route('/performance', performancePublicRoutes);
  // A form's link, answered without an account (spec 032).
  open.route('/forms', formsPublicRoutes);
  // The factory's signed reports (spec 021).
  open.route('/factory', factoryReportRoutes);
  // The apps' business events, with their own token (spec 025).
  open.route('/apps', appEventRoutes);
  api.route('/public', open);
  // A refused gesture says why, with a stable code the screens translate.
  api.onError((error, c) => {
    if (error instanceof GestureRefusal) {
      return c.json({ error: error.code, message: error.message }, error.status);
    }
    console.error(error);
    return c.json({ error: 'internal' }, 500);
  });
  return api;
}
