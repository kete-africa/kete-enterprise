import type { CommandDefinition } from '@kete/commands';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { reach } from '../rights/index.js';
import { knownChecks } from './checks.js';
import {
  addRequirement,
  approveDocument,
  assignAction,
  attestControl,
  collectEvidence,
  completeAction,
  ComplianceRuleError,
  concludeAuditCommand,
  defineControl,
  defineFramework,
  linkControlCommand,
  planAudit,
  raiseFinding,
  recordCertificate,
  verifyAction,
  writeDocumentCommand,
} from './commands.js';
import { findControl, holdsPosition } from './infrastructure/compliance.tables.js';
import { complianceOverview } from './overview.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 008). */
export const compliancePermissions = ['compliance:read', 'compliance:manage'] as const;

async function everywhere(c: Ctx, db: SqlExecutor, permission: string): Promise<boolean> {
  return (await reach(db, c.get('identity'), permission)).everywhere;
}

async function run<Input extends z.ZodType, Output>(
  c: Ctx,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Response> {
  try {
    return c.json(await runGesture(c, definition, input), 201);
  } catch (error) {
    if (error instanceof ComplianceRuleError) {
      throw new GestureRefusal(error.code === 'not_found' ? 404 : 409, error.code, error.message);
    }
    throw error;
  }
}

const forbidden = () =>
  new GestureRefusal(403, 'forbidden', 'This needs « compliance:manage » for the organization.');

/** A gesture of a compliance manager. */
function managed<Input extends z.ZodType, Output>(
  definition: CommandDefinition<Input, Output>,
  param?: string,
) {
  return async (c: Ctx) => {
    const allowed = await transaction(c.get('identity').organizationId, (db) =>
      everywhere(c, db, 'compliance:manage'),
    );
    if (!allowed) throw forbidden();
    const body = (await bodyOf(c)) as Record<string, unknown>;
    return run(c, definition, param ? { ...body, [param]: c.req.param(param) } : body);
  };
}

/** The compliance routes, under /v1/compliance (spec 008). */
export const complianceRoutes = new Hono<{ Variables: IdentityVariables }>()
  .get('/', async (c) => {
    const overview = await transaction(c.get('identity').organizationId, async (db) => {
      const reads =
        (await everywhere(c, db, 'compliance:read')) ||
        (await everywhere(c, db, 'compliance:manage'));
      return reads ? complianceOverview(db) : null;
    });
    if (!overview) throw new GestureRefusal(403, 'forbidden', 'This needs « compliance:read ».');
    return c.json({ ...overview, checks: knownChecks() });
  })
  .post('/frameworks', managed(defineFramework))
  .post('/requirements', managed(addRequirement))
  .post('/controls', managed(defineControl))
  .post('/controls/links', managed(linkControlCommand))
  .post('/controls/:controlId/collect', managed(collectEvidence, 'controlId'))
  // The holder of the control's owner position attests it, or a compliance manager.
  .post('/controls/:controlId/attest', async (c) => {
    const controlId = c.req.param('controlId');
    const identity = c.get('identity');
    const allowed = await transaction(identity.organizationId, async (db) => {
      if (await everywhere(c, db, 'compliance:manage')) return true;
      const control = await findControl(db, controlId);
      return Boolean(
        control?.ownerPositionId &&
        (await holdsPosition(db, identity.userId, control.ownerPositionId)),
      );
    });
    if (!allowed) throw forbidden();
    return run(c, attestControl, { ...((await bodyOf(c)) as object), controlId });
  })
  .post('/documents', managed(writeDocumentCommand))
  .post('/documents/:documentId/approve', managed(approveDocument, 'documentId'))
  .post('/audits', managed(planAudit))
  .post('/audits/:auditId/conclude', managed(concludeAuditCommand, 'auditId'))
  .post('/findings', managed(raiseFinding))
  .post('/actions', managed(assignAction))
  // Its owner completes an action; the command checks she is.
  .post('/actions/:actionId/complete', async (c) =>
    run(c, completeAction, { actionId: c.req.param('actionId') }),
  )
  .post('/actions/:actionId/verify', managed(verifyAction, 'actionId'))
  .post('/certificates', managed(recordCertificate));
