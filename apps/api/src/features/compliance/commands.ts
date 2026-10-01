import { defineCommand } from '@kete/commands';
import { knownChecks, runCheck } from './checks.js';
import {
  actionStepInput,
  addRequirementInput,
  approveDocumentInput,
  assignActionInput,
  attestInput,
  collectInput,
  concludeAuditInput,
  defineControlInput,
  defineFrameworkInput,
  linkControlInput,
  planAuditInput,
  raiseFindingInput,
  recordCertificateInput,
  writeDocumentInput,
} from './compliance.record.js';
import {
  approveVersion,
  concludeAudit,
  findAction,
  findControl,
  findVersion,
  insertAction,
  insertAudit,
  insertCertificate,
  insertControl,
  insertEvidence,
  insertFinding,
  insertFramework,
  insertRequirement,
  linkControl,
  markActionDone,
  markActionVerified,
  writeDocument,
} from './infrastructure/compliance.tables.js';

/** A rule of compliance was not met: the change is refused, nothing is written. */
export class ComplianceRuleError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'duplicate'
      | 'unknown_check'
      | 'not_automatic'
      | 'not_attested'
      | 'own_writing'
      | 'not_draft'
      | 'not_owner'
      | 'not_done'
      | 'own_action',
    message: string,
  ) {
    super(message);
    this.name = 'ComplianceRuleError';
  }
}

/** A database refusal (a reference into nothing, a duplicate) in the feature's words. */
async function stored<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23503')
      throw new ComplianceRuleError('not_found', 'Something referenced does not exist here.');
    if (code === '23505') throw new ComplianceRuleError('duplicate', 'This already exists.');
    throw error;
  }
}

const person = (actor: { id: string; onBehalfOf?: { id: string } | undefined }) =>
  actor.onBehalfOf?.id ?? actor.id;

export const defineFramework = defineCommand({
  name: 'define-framework',
  input: defineFrameworkInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => stored(insertFramework(db, organizationId, input)),
  summarize: (input) => `Framework ${input.code} "${input.name}" recorded`,
});

export const addRequirement = defineCommand({
  name: 'add-requirement',
  input: addRequirementInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => stored(insertRequirement(db, organizationId, input)),
  summarize: (input) => `Requirement ${input.reference} added`,
});

export const defineControl = defineCommand({
  name: 'define-control',
  input: defineControlInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    if (input.check && !knownChecks().includes(input.check)) {
      throw new ComplianceRuleError('unknown_check', `No check named ${input.check}.`);
    }
    const { controlId } = await stored(insertControl(db, organizationId, input));
    // One control, many frameworks: a single piece of evidence serves them all.
    for (const requirementId of input.requirementIds) {
      await stored(linkControl(db, organizationId, controlId, requirementId));
    }
    return { controlId };
  },
  summarize: (input) => `Control "${input.name}" defined (${input.method})`,
});

export const linkControlCommand = defineCommand({
  name: 'link-control',
  input: linkControlInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    await stored(linkControl(db, organizationId, input.controlId, input.requirementId));
    return input;
  },
  summarize: (input) => `Control ${input.controlId} linked to ${input.requirementId}`,
});

/** A person attests a control; the attestation is evidence, with its fingerprint. */
export const attestControl = defineCommand({
  name: 'attest-control',
  input: attestInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const control = await findControl(db, input.controlId);
    if (!control) throw new ComplianceRuleError('not_found', 'The control does not exist here.');
    if (control.method !== 'attestation') {
      throw new ComplianceRuleError('not_attested', 'This control is checked automatically.');
    }
    return insertEvidence(db, organizationId, {
      controlId: input.controlId,
      source: 'attestation',
      outcome: input.outcome,
      summary: input.summary,
      details: {},
      collectedBy: person(actor),
      frequencyDays: control.frequencyDays,
    });
  },
  summarize: (input) => `Control ${input.controlId} attested: ${input.outcome}`,
});

/** Runs an automatic control's check on the company's records, and keeps what it found. */
export const collectEvidence = defineCommand({
  name: 'collect-evidence',
  input: collectInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const control = await findControl(db, input.controlId);
    if (!control) throw new ComplianceRuleError('not_found', 'The control does not exist here.');
    const check = control.check ? runCheck(db, control.check) : null;
    if (!check)
      throw new ComplianceRuleError('not_automatic', 'This control is attested by a person.');
    const found = await check;
    const evidence = await insertEvidence(db, organizationId, {
      controlId: input.controlId,
      source: 'automatic',
      outcome: found.outcome,
      summary: `${control.check}: ${found.details.count}`,
      details: found.details,
      collectedBy: actor.id,
      frequencyDays: control.frequencyDays,
    });
    return { ...evidence, outcome: found.outcome, details: found.details };
  },
  summarize: (input) => `Evidence collected for ${input.controlId}`,
});

export const writeDocumentCommand = defineCommand({
  name: 'write-document',
  input: writeDocumentInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const written = await writeDocument(db, organizationId, { ...input, writtenBy: person(actor) });
    if (!written) throw new ComplianceRuleError('not_found', 'The document does not exist here.');
    return written;
  },
  summarize: (input) => `Document "${input.title}": a new version written`,
  // A document can be long: the journal keeps the gesture, the version keeps the text.
  journalInput: false,
});

/** A version becomes current once someone other than its author approves it. */
export const approveDocument = defineCommand({
  name: 'approve-document',
  input: approveDocumentInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const version = await findVersion(db, input.documentId, input.version);
    if (!version) throw new ComplianceRuleError('not_found', 'The version does not exist here.');
    if (version.status !== 'draft')
      throw new ComplianceRuleError('not_draft', 'Only a draft is approved.');
    if (version.written_by === person(actor)) {
      throw new ComplianceRuleError(
        'own_writing',
        'A version is approved by someone other than its author.',
      );
    }
    await approveVersion(db, input.documentId, input.version, person(actor));
    return input;
  },
  summarize: (input) => `Document ${input.documentId} version ${input.version} approved`,
});

export const planAudit = defineCommand({
  name: 'plan-audit',
  input: planAuditInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => stored(insertAudit(db, organizationId, input)),
  summarize: (input) => `${input.kind} audit planned on ${input.plannedOn}`,
});

export const concludeAuditCommand = defineCommand({
  name: 'conclude-audit',
  input: concludeAuditInput,
  reversibility: { reversible: false },
  async handler(input, { db }) {
    if (!(await concludeAudit(db, input.auditId, input.conclusion))) {
      throw new ComplianceRuleError('not_found', 'The audit does not exist here.');
    }
    return { auditId: input.auditId };
  },
  summarize: (input) => `Audit ${input.auditId} concluded`,
});

export const raiseFinding = defineCommand({
  name: 'raise-finding',
  input: raiseFindingInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId, actor }) =>
    stored(insertFinding(db, organizationId, { ...input, raisedBy: person(actor) })),
  summarize: (input) => `${input.severity} finding raised`,
});

export const assignAction = defineCommand({
  name: 'assign-corrective-action',
  input: assignActionInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => stored(insertAction(db, organizationId, input)),
  summarize: (input) => `Corrective action due on ${input.dueOn}`,
});

/** Its owner says the action is done. */
export const completeAction = defineCommand({
  name: 'complete-corrective-action',
  input: actionStepInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const action = await findAction(db, input.actionId);
    if (!action) throw new ComplianceRuleError('not_found', 'The action does not exist here.');
    if (action.owner_user_id !== person(actor)) {
      throw new ComplianceRuleError('not_owner', 'Only its owner says an action is done.');
    }
    await markActionDone(db, input.actionId, person(actor));
    return { actionId: input.actionId, status: 'done' };
  },
  summarize: (input) => `Corrective action ${input.actionId} done`,
});

/** Someone else verifies its effectiveness; the finding closes when all its actions are verified. */
export const verifyAction = defineCommand({
  name: 'verify-corrective-action',
  input: actionStepInput,
  reversibility: { reversible: false },
  async handler(input, { db, actor }) {
    const action = await findAction(db, input.actionId);
    if (!action) throw new ComplianceRuleError('not_found', 'The action does not exist here.');
    if (action.status !== 'done')
      throw new ComplianceRuleError('not_done', 'The action is not done yet.');
    if (action.done_by === person(actor)) {
      throw new ComplianceRuleError('own_action', 'Effectiveness is verified by someone else.');
    }
    const closed = await markActionVerified(db, input.actionId, person(actor));
    return { actionId: input.actionId, status: 'verified', findingClosed: closed };
  },
  summarize: (input) => `Corrective action ${input.actionId} verified`,
});

export const recordCertificate = defineCommand({
  name: 'record-certificate',
  input: recordCertificateInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => stored(insertCertificate(db, organizationId, input)),
  summarize: (input) => `Certificate ${input.number} recorded`,
});
