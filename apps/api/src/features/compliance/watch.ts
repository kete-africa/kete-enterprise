import { registerWatch, type Finding } from '../agents/index.js';
import { reach } from '../rights/index.js';
import { complianceOverview } from './overview.js';

const inDays = (from: string, days: number) => {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * The controls watch (D-039: the first permanent agent, level 1): controls failing, expired or
 * missing, corrective actions overdue, certificates expiring within sixty days. It reads only if
 * its person may read compliance for the whole organization, and changes nothing.
 */
registerWatch('compliance', 'compliance:read', async (db, person, scope) => {
  const readable =
    (await reach(db, person, 'compliance:read')).everywhere ||
    (await reach(db, person, 'compliance:manage')).everywhere;
  if (!readable) return [];
  const overview = await complianceOverview(db);
  const inScope = (unitId: string | null) =>
    scope === null || (unitId !== null && scope.has(unitId));
  const findings: Finding[] = [];
  for (const control of overview.controls) {
    if (control.status === 'passing' || !inScope(control.scopeUnitId)) continue;
    findings.push({
      key: `compliance.control_${control.status}:${control.controlId}`,
      kind: `compliance.control_${control.status}`,
      subject: control.name,
      unitId: control.scopeUnitId,
      details: { controlId: control.controlId, evidenceId: control.evidence?.evidenceId ?? null },
    });
  }
  for (const finding of overview.findings) {
    for (const action of finding.actions) {
      if (action.status !== 'open' || action.dueOn >= overview.today) continue;
      findings.push({
        key: `compliance.action_overdue:${action.actionId}`,
        kind: 'compliance.action_overdue',
        subject: action.description,
        unitId: null,
        details: { actionId: action.actionId, dueOn: action.dueOn },
      });
    }
  }
  const soon = inDays(overview.today, 60);
  for (const framework of overview.frameworks) {
    for (const certificate of framework.certificates) {
      if (certificate.expiresOn > soon || !inScope(certificate.scopeUnitId)) continue;
      findings.push({
        key: `compliance.certificate_expiring:${certificate.certificateId}`,
        kind: 'compliance.certificate_expiring',
        subject: `${framework.name} · ${certificate.number}`,
        unitId: certificate.scopeUnitId,
        details: { certificateId: certificate.certificateId, expiresOn: certificate.expiresOn },
      });
    }
  }
  return findings;
});
