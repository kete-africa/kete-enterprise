import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { actorOf, bodyOf, GestureRefusal, runCommand } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { savePolicyCommand, setPolicyStatus } from '../policies/index.js';
import { isAdministrator } from '../rights/index.js';
import { readable } from './access.js';
import {
  confirmGestures,
  confirmInput,
  declineProposal,
  inviteToKete,
  markPolicy,
  policyToDecide,
  ProposalError,
  stopTurn,
  workingTurn,
} from './door.js';

// Kete's door, under /v1/threads (spec 099, FR-007 to FR-011): the turn at work and « Arrêter »,
// her « oui », « corriger » or « non » to a set of gestures, a policy adopted or tried, and her
// thread « Kete » opened to a colleague.

type Ctx = Context<{ Variables: IdentityVariables }>;

const proposalId = z.string().regex(/^prp_[0-9A-Za-z_-]{8,70}$/);
const turnId = z.string().regex(/^trn_[0-9A-Za-z_-]{8,70}$/);

function refused(error: unknown): never {
  if (error instanceof ProposalError) {
    const status = { not_found: 404, settled: 409, invalid: 422 } as const;
    throw new GestureRefusal(status[error.code], error.code, error.message);
  }
  throw error;
}

function hers(c: Ctx) {
  if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to decide.');
  return c.get('identity');
}

export const doorRoutes = new Hono<{ Variables: IdentityVariables }>()
  // The turn at work in a thread, its steps and its words so far (FR-009).
  .get('/:threadId/turn', async (c: Ctx) => {
    const identity = c.get('identity');
    const turn = await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      return workingTurn(db, thread.id);
    });
    return c.json({ turn });
  })
  // « Arrêter »: the turn she asked stops; what was said stays.
  .post('/turns/:turnId/stop', async (c: Ctx) => {
    const identity = hers(c);
    const id = turnId.safeParse(c.req.param('turnId'));
    if (!id.success) throw new GestureRefusal(422, 'invalid_input', 'Which turn?');
    const stopped = await transaction(identity.organizationId, (db) =>
      stopTurn(db, id.data, identity.userId),
    );
    if (!stopped) throw new GestureRefusal(409, 'settled', 'This turn is no longer at work.');
    return c.json({ stopped: true });
  })
  // Her « oui » to a set of gestures — the ones she keeps, as she corrected them (FR-010).
  .post('/proposals/:proposalId/confirm', async (c: Ctx) => {
    const identity = hers(c);
    const id = proposalId.safeParse(c.req.param('proposalId'));
    const parsed = confirmInput.safeParse(await bodyOf(c));
    if (!id.success || !parsed.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Which proposal, and what she keeps.');
    }
    const made = await transaction(identity.organizationId, (db) =>
      confirmGestures(db, identity, id.data, parsed.data),
    ).catch(refused);
    return c.json({ made }, 201);
  })
  // Her « non »: nothing is made.
  .post('/proposals/:proposalId/decline', async (c: Ctx) => {
    const identity = hers(c);
    const id = proposalId.safeParse(c.req.param('proposalId'));
    if (!id.success) throw new GestureRefusal(422, 'invalid_input', 'Which proposal?');
    await transaction(identity.organizationId, (db) =>
      declineProposal(db, identity.userId, id.data),
    ).catch(refused);
    return c.json({ declined: true });
  })
  // A rule become a policy (FR-011): on trial, or adopted at once — by an administrator.
  .post('/proposals/:proposalId/policy', async (c: Ctx) => {
    const identity = hers(c);
    const id = proposalId.safeParse(c.req.param('proposalId'));
    const how = z.object({ how: z.enum(['adopt', 'trial']) }).safeParse(await bodyOf(c));
    if (!id.success || !how.success) {
      throw new GestureRefusal(422, 'invalid_input', 'Which proposal, adopted or tried.');
    }
    if (!isAdministrator(identity)) {
      throw new GestureRefusal(403, 'forbidden', 'An administrator adopts a policy.');
    }
    const policy = await transaction(identity.organizationId, (db) =>
      policyToDecide(db, identity.userId, id.data),
    ).catch(refused);
    const key = c.req.header('idempotency-key') ?? `${id.data}:${how.data.how}`;
    await runCommand(identity.organizationId, actorOf(c), `${key}:save`, savePolicyCommand, {
      id: policy.id,
      sentence: policy.sentence,
      rule: policy.rule,
      set: policy.set,
      ...(policy.approver ? { approver: policy.approver } : {}),
    });
    if (how.data.how === 'adopt') {
      await runCommand(identity.organizationId, actorOf(c), `${key}:status`, setPolicyStatus, {
        policyId: policy.id,
        status: 'active',
      });
    }
    await transaction(identity.organizationId, (db) =>
      markPolicy(db, id.data, how.data.how === 'adopt' ? 'adopted' : 'trial', policy.id),
    );
    return c.json({ policyId: policy.id, status: how.data.how === 'adopt' ? 'active' : 'trial' });
  })
  // « Inviter quelqu’un »: her thread « Kete » becomes a group (FR-007).
  .post('/:threadId/invite', async (c: Ctx) => {
    const identity = hers(c);
    const parsed = z
      .object({ people: z.array(z.string().min(1).max(100)).min(1).max(20) })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Whom to invite.');
    await transaction(identity.organizationId, async (db) => {
      const thread = await readable(db, identity, c.req.param('threadId') ?? '');
      await inviteToKete(db, identity, thread, parsed.data.people);
    }).catch(refused);
    return c.json({ invited: parsed.data.people.length }, 201);
  });
