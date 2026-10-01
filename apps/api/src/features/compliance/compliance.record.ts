import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{8,64}$`));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is written YYYY-MM-DD.');
const text = (max: number) => z.string().trim().min(1).max(max);

export const frameworkId = id('fwk');
export const requirementId = id('req');
export const controlId = id('ctl');
export const documentId = id('doc');
export const auditId = id('aud');
export const findingId = id('fnd');
export const actionId = id('cac');

/** A standard, a law, an internal policy, a client's requirements or a contract (D-040). */
export const frameworkKinds = ['standard', 'law', 'policy', 'customer', 'contract'] as const;

export const defineFrameworkInput = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/),
  name: text(160),
  edition: z.string().trim().max(40).optional(),
  kind: z.enum(frameworkKinds),
  scopeUnitId: id('unt').optional(),
});

/** A requirement: its clause's reference, and a summary in the company's own words (never the text). */
export const addRequirementInput = z.object({
  frameworkId,
  reference: text(40),
  summary: text(1000),
});

export const defineControlInput = z
  .object({
    name: text(160),
    description: text(2000),
    ownerPositionId: id('pos').optional(),
    frequencyDays: z
      .number()
      .int()
      .min(1)
      .max(3 * 365),
    method: z.enum(['automatic', 'attestation']),
    /** For an automatic control: the check that reads the company's records. */
    check: z
      .string()
      .regex(/^[a-z]+\.[a-z_]+$/)
      .optional(),
    scopeUnitId: id('unt').optional(),
    requirementIds: z.array(requirementId).max(50).default([]),
  })
  .refine((c) => (c.method === 'automatic') === Boolean(c.check), {
    message: 'An automatic control names its check, and only it does.',
  });

export const linkControlInput = z.object({ controlId, requirementId });

export const attestInput = z.object({
  controlId,
  outcome: z.enum(['pass', 'fail']),
  summary: text(2000),
});

export const collectInput = z.object({ controlId });

export const writeDocumentInput = z.object({
  /** A new document, or a new version of an existing one. */
  documentId: documentId.optional(),
  title: text(200),
  kind: z.enum(['policy', 'procedure', 'record']),
  content: z.string().min(1).max(200_000),
});

export const approveDocumentInput = z.object({ documentId, version: z.number().int().min(1) });

export const planAuditInput = z.object({
  frameworkId: frameworkId.optional(),
  kind: z.enum(['internal', 'external']),
  scopeUnitId: id('unt').optional(),
  plannedOn: day,
});

export const concludeAuditInput = z.object({ auditId, conclusion: text(4000) });

export const raiseFindingInput = z
  .object({
    auditId: auditId.optional(),
    controlId: controlId.optional(),
    severity: z.enum(['major', 'minor', 'observation']),
    description: text(4000),
  })
  .refine((f) => Boolean(f.auditId || f.controlId), {
    message: 'A finding comes from an audit or a control.',
  });

export const assignActionInput = z.object({
  findingId,
  description: text(2000),
  ownerUserId: z.string().min(1).max(128),
  dueOn: day,
});

export const actionStepInput = z.object({ actionId });

export const recordCertificateInput = z
  .object({
    frameworkId,
    body: text(160),
    number: text(80),
    scopeUnitId: id('unt').optional(),
    issuedOn: day,
    expiresOn: day,
    nextSurveillanceOn: day.optional(),
  })
  .refine((c) => c.expiresOn > c.issuedOn, {
    message: 'A certificate expires after it is issued.',
  });

/** What a control's latest evidence says today. */
export type ControlStatus = 'passing' | 'failing' | 'expired' | 'missing';

export function statusOf(
  latest: { outcome: 'pass' | 'fail'; validUntil: string } | null,
  today: string,
): ControlStatus {
  if (!latest) return 'missing';
  if (latest.outcome === 'fail') return 'failing';
  return latest.validUntil < today ? 'expired' : 'passing';
}
