import { defineCommand } from '@kete/commands';
import { z } from 'zod';
import {
  ancestorsOf,
  closePosition,
  closeUnit,
  endAssignment,
  findAssignment,
  findPosition,
  findUnit,
  insertAssignment,
  insertPerson,
  insertPosition,
  insertUnit,
  insertUnitType,
  lockPerson,
  overlappingPrimary,
  personOfAccount,
  setPersonAccount,
  setUnitParent,
  unlinkedPeopleWithEmail,
  updatePersonRow,
} from './infrastructure/structure.tables.js';
import {
  addPersonInput,
  assignPersonInput,
  closePositionInput,
  closeUnitInput,
  createPositionInput,
  createUnitInput,
  createUnitTypeInput,
  endAssignmentInput,
  importPeopleInput,
  linkPersonAccountInput,
  moveUnitInput,
  updatePersonInput,
  type ImportReport,
  type Person,
} from './structure.record.js';

/** A rule of the structure was not met: the change is refused, nothing is written. */
export class StructureRuleError extends Error {
  constructor(
    readonly code:
      'not_found' | 'cycle' | 'closed' | 'primary_overlap' | 'ends_before_start' | 'duplicate',
    message: string,
  ) {
    super(message);
    this.name = 'StructureRuleError';
  }
}

function notFound(what: string): never {
  throw new StructureRuleError('not_found', `${what} does not exist in this organization.`);
}

export const createUnitType = defineCommand({
  name: 'create-unit-type',
  input: createUnitTypeInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => insertUnitType(db, organizationId, input),
  summarize: (input) => `Unit type "${input.name}" created`,
});

export const createUnit = defineCommand({
  name: 'create-unit',
  input: createUnitInput,
  // Undone by closing it.
  reversibility: { reversible: true, inverse: 'close-unit' },
  async handler(input, { db, organizationId }) {
    if (input.parentId) {
      const parent = await findUnit(db, input.parentId);
      if (!parent) notFound('The parent unit');
      if (parent.endsOn) throw new StructureRuleError('closed', 'The parent unit is closed.');
    }
    return insertUnit(db, organizationId, input);
  },
  summarize: (input) => `Unit "${input.name}" created`,
});

export const moveUnit = defineCommand({
  name: 'move-unit',
  input: moveUnitInput,
  reversibility: { reversible: true, inverse: 'move-unit' },
  async handler(input, { db }) {
    if (!(await findUnit(db, input.unitId))) notFound('The unit');
    if (input.parentId) {
      const parent = await findUnit(db, input.parentId);
      if (!parent) notFound('The new parent unit');
      if (parent.endsOn) throw new StructureRuleError('closed', 'The new parent unit is closed.');
      // A unit never goes under itself or one of its own descendants.
      if ((await ancestorsOf(db, input.parentId)).includes(input.unitId)) {
        throw new StructureRuleError('cycle', 'A unit cannot move under itself or its own units.');
      }
    }
    await setUnitParent(db, input.unitId, input.parentId);
    return { unitId: input.unitId, parentId: input.parentId };
  },
  summarize: (input) => `Unit ${input.unitId} moved`,
});

export const closeUnitCommand = defineCommand({
  name: 'close-unit',
  input: closeUnitInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const unit = await findUnit(db, input.unitId);
    if (!unit) notFound('The unit');
    if (input.endsOn < unit.startsOn) {
      throw new StructureRuleError('ends_before_start', 'A unit cannot close before it opened.');
    }
    await closeUnit(db, input.unitId, input.endsOn);
    return { unitId: input.unitId, endsOn: input.endsOn };
  },
  summarize: (input) => `Unit ${input.unitId} closed on ${input.endsOn}`,
});

export const createPosition = defineCommand({
  name: 'create-position',
  input: createPositionInput,
  reversibility: { reversible: true, inverse: 'close-position' },
  async handler(input, { db, organizationId }) {
    const unit = await findUnit(db, input.unitId);
    if (!unit) notFound('The unit');
    if (unit.endsOn) throw new StructureRuleError('closed', 'The unit is closed.');
    // The line may cross units and legal entities: any open position of the organization.
    if (input.reportsTo) {
      const manager = await findPosition(db, input.reportsTo);
      if (!manager) notFound('The position it reports to');
      if (manager.endsOn) throw new StructureRuleError('closed', 'That position is closed.');
    }
    return insertPosition(db, organizationId, input);
  },
  summarize: (input) => `Position "${input.title}" created`,
});

export const closePositionCommand = defineCommand({
  name: 'close-position',
  input: closePositionInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const position = await findPosition(db, input.positionId);
    if (!position) notFound('The position');
    if (input.endsOn < position.startsOn) {
      throw new StructureRuleError(
        'ends_before_start',
        'A position cannot close before it opened.',
      );
    }
    await closePosition(db, input.positionId, input.endsOn);
    return { positionId: input.positionId, endsOn: input.endsOn };
  },
  summarize: (input) => `Position ${input.positionId} closed on ${input.endsOn}`,
});

export const addPerson = defineCommand({
  name: 'add-person',
  input: addPersonInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => insertPerson(db, organizationId, input),
  summarize: () => 'A person added',
  // A person's name, e-mail and phone are personal data: the journal keeps the gesture, not them.
  journalInput: false,
});

export const updatePerson = defineCommand({
  name: 'update-person',
  input: updatePersonInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    if (!(await lockPerson(db, input.personId))) notFound('The person');
    return updatePersonRow(db, input.personId, input);
  },
  summarize: (input) => `Person ${input.personId} corrected`,
  journalInput: false,
});

export const linkPersonAccount = defineCommand({
  name: 'link-person-account',
  input: linkPersonAccountInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    if (!(await lockPerson(db, input.personId))) notFound('The person');
    if (input.accountUserId) {
      const holder = await personOfAccount(db, input.accountUserId);
      if (holder && holder.personId !== input.personId) {
        throw new StructureRuleError('duplicate', 'This account is linked to another person.');
      }
    }
    await setPersonAccount(db, input.personId, input.accountUserId);
    return { personId: input.personId, linked: input.accountUserId !== null };
  },
  summarize: (input) =>
    input.accountUserId
      ? `Person ${input.personId} linked to an account`
      : `Person ${input.personId} unlinked from her account`,
  journalInput: false,
});

/**
 * Links the signed-in account to the one person of the organization who carries its e-mail and has
 * no account yet. The Compte Kete verifies e-mails before it signs anyone in.
 */
export const linkAccountByEmail = defineCommand({
  name: 'link-account',
  input: z.object({ accountUserId: z.string().min(1).max(128), email: z.email() }),
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const already = await personOfAccount(db, input.accountUserId);
    if (already) return { personId: already.personId, linked: false };
    const candidates = await unlinkedPeopleWithEmail(db, input.email);
    // Two people with one e-mail: an administrator decides, nobody guesses.
    if (candidates.length !== 1) return { personId: null, linked: false };
    const person = candidates[0] as Person;
    await setPersonAccount(db, person.personId, input.accountUserId);
    return { personId: person.personId, linked: true };
  },
  summarize: () => 'An account found its person by e-mail',
  journalInput: false,
});

export const importPeople = defineCommand({
  name: 'import-people',
  input: importPeopleInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }): Promise<ImportReport> {
    const startsOn = input.startsOn ?? new Date().toISOString().slice(0, 10);
    const report: ImportReport = { created: 0, refused: [] };
    const seen = new Set<string>();
    for (const [index, raw] of input.rows.entries()) {
      const row = index + 1;
      const parsed = addPersonInput.safeParse({
        name: raw.name,
        ...(raw.email?.trim() ? { email: raw.email.trim() } : {}),
        ...(raw.phone?.trim() ? { phone: raw.phone.replace(/[\s.-]/g, '') } : {}),
      });
      if (!parsed.success) {
        report.refused.push({ row, code: 'invalid_row' });
        continue;
      }
      const email = parsed.data.email?.toLowerCase();
      if (email && (seen.has(email) || (await unlinkedPeopleWithEmail(db, email)).length > 0)) {
        report.refused.push({ row, code: 'duplicate_email' });
        continue;
      }
      let positionId: string | null = null;
      if (raw.positionId?.trim()) {
        const position = await findPosition(db, raw.positionId.trim());
        if (!position) {
          report.refused.push({ row, code: 'not_found' });
          continue;
        }
        if (position.endsOn && position.endsOn < startsOn) {
          report.refused.push({ row, code: 'closed' });
          continue;
        }
        positionId = position.positionId;
      }
      if (email) seen.add(email);
      const person = await insertPerson(db, organizationId, parsed.data);
      if (positionId) {
        await insertAssignment(db, organizationId, {
          personId: person.personId,
          positionId,
          kind: 'primary',
          startsOn,
        });
      }
      report.created += 1;
    }
    return report;
  },
  summarize: (input) => `${input.rows.length} row(s) imported`,
  journalInput: false,
});

export const assignPerson = defineCommand({
  name: 'assign-person',
  input: assignPersonInput,
  reversibility: { reversible: true, inverse: 'end-assignment' },
  async handler(input, { db, organizationId }) {
    if (input.endsOn && input.endsOn < input.startsOn) {
      throw new StructureRuleError(
        'ends_before_start',
        'An assignment cannot end before it starts.',
      );
    }
    if (!(await lockPerson(db, input.personId))) notFound('The person');
    const position = await findPosition(db, input.positionId);
    if (!position) notFound('The position');
    if (position.endsOn && position.endsOn < input.startsOn) {
      throw new StructureRuleError('closed', 'The position is closed at that date.');
    }
    // One primary position at a time.
    if (input.kind === 'primary') {
      const overlap = await overlappingPrimary(
        db,
        input.personId,
        input.startsOn,
        input.endsOn ?? null,
      );
      if (overlap.length > 0) {
        throw new StructureRuleError(
          'primary_overlap',
          'This person already has a primary position over that period.',
        );
      }
    }
    return insertAssignment(db, organizationId, input);
  },
  summarize: (input) => `Person ${input.personId} assigned to ${input.positionId} (${input.kind})`,
});

export const endAssignmentCommand = defineCommand({
  name: 'end-assignment',
  input: endAssignmentInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    const assignment = await findAssignment(db, input.assignmentId);
    if (!assignment) notFound('The assignment');
    if (input.endsOn < assignment.startsOn) {
      throw new StructureRuleError(
        'ends_before_start',
        'An assignment cannot end before it starts.',
      );
    }
    await endAssignment(db, input.assignmentId, input.endsOn);
    return { assignmentId: input.assignmentId, endsOn: input.endsOn };
  },
  summarize: (input) => `Assignment ${input.assignmentId} ended on ${input.endsOn}`,
});
