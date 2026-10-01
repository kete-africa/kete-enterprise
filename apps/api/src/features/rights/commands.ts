import { defineCommand } from '@kete/commands';
import {
  endGrant,
  findGrant,
  findRole,
  insertGrant,
  insertRole,
  setRolePermissions,
} from './infrastructure/rights.tables.js';
import {
  createRoleInput,
  grantRoleInput,
  revokeGrantInput,
  setRolePermissionsInput,
} from './rights.record.js';

/** A rule of the rights was not met: the change is refused, nothing is written. */
export class RightsRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'ends_before_start' | 'duplicate',
    message: string,
  ) {
    super(message);
    this.name = 'RightsRuleError';
  }
}

/** A database refusal of a reference into nothing, or of a duplicate, said in the feature's words. */
async function referenced<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23503') {
      throw new RightsRuleError(
        'not_found',
        'A position, person, unit or role does not exist here.',
      );
    }
    if (code === '23505') throw new RightsRuleError('duplicate', 'A role of that name exists.');
    throw error;
  }
}

export const createRole = defineCommand({
  name: 'create-role',
  input: createRoleInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => referenced(insertRole(db, organizationId, input)),
  summarize: (input) => `Role "${input.name}" created`,
});

export const setRolePermissionsCommand = defineCommand({
  name: 'set-role-permissions',
  input: setRolePermissionsInput,
  reversibility: { reversible: true, inverse: 'set-role-permissions' },
  async handler(input, { db }) {
    const role = await findRole(db, input.roleId);
    if (!role) throw new RightsRuleError('not_found', 'The role does not exist here.');
    await setRolePermissions(db, input.roleId, input.permissions);
    return { roleId: input.roleId, before: role.permissions, permissions: input.permissions };
  },
  summarize: (input) =>
    `Role ${input.roleId} now allows ${input.permissions.join(', ') || 'nothing'}`,
});

export const grantRole = defineCommand({
  name: 'grant-role',
  input: grantRoleInput,
  reversibility: { reversible: true, inverse: 'revoke-grant' },
  handler(input, { db, organizationId }) {
    if (input.endsOn && input.startsOn && input.endsOn < input.startsOn) {
      throw new RightsRuleError('ends_before_start', 'A grant cannot end before it starts.');
    }
    return referenced(insertGrant(db, organizationId, input));
  },
  summarize: (input) =>
    `Role ${input.roleId} granted to ${input.positionId ?? input.personId} on ${
      input.scopeUnitId ?? input.scopeCountry ?? 'the whole organization'
    }`,
});

export const revokeGrant = defineCommand({
  name: 'revoke-grant',
  input: revokeGrantInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const grant = await findGrant(db, input.grantId);
    if (!grant) throw new RightsRuleError('not_found', 'The grant does not exist here.');
    if (input.endsOn < grant.startsOn) {
      throw new RightsRuleError('ends_before_start', 'A grant cannot end before it starts.');
    }
    await endGrant(db, input.grantId, input.endsOn);
    return { grantId: input.grantId, endsOn: input.endsOn };
  },
  summarize: (input) => `Grant ${input.grantId} ends on ${input.endsOn}`,
});
