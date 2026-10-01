import type { SqlExecutor } from '@kete/tenancy';
import { statusOf, type ControlStatus } from './compliance.record.js';
import { readCompliance } from './infrastructure/compliance.tables.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Compliance as a manager reads it: every framework with its requirements, each requirement with
 * the controls that answer it and their status today; never a percentage (D-040). The same control
 * appears under every framework it serves.
 */
export async function complianceOverview(db: SqlExecutor) {
  const data = await readCompliance(db);
  const now = today();
  const latest = new Map(data.latest.map((e) => [e.controlId, e]));
  const controls = data.controls.map((c) => {
    const evidence = latest.get(c.controlId) ?? null;
    return {
      ...c,
      status: statusOf(evidence, now) as ControlStatus,
      evidence,
      requirementIds: data.links
        .filter((l) => l.controlId === c.controlId)
        .map((l) => l.requirementId),
    };
  });
  const byRequirement = (requirementId: string) =>
    controls
      .filter((c) => c.requirementIds.includes(requirementId))
      .map((c) => ({ controlId: c.controlId, name: c.name, status: c.status }));
  return {
    today: now,
    frameworks: data.frameworks.map((f) => ({
      ...f,
      requirements: data.requirements
        .filter((r) => r.frameworkId === f.frameworkId)
        .map((r) => ({ ...r, controls: byRequirement(r.requirementId) })),
      certificates: data.certificates.filter((c) => c.frameworkId === f.frameworkId),
    })),
    controls,
    documents: data.documents,
    audits: data.audits,
    findings: data.findings,
  };
}
