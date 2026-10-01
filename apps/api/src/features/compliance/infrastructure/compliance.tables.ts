import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import { createHash } from 'node:crypto';

/** Compliance's tables, each with its row-level security in the same migration (D-040). */
export function complianceMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const app = options.appRole;
  const policy = (table: string) => organizationPolicySql({ schema: s, table, appRole: app });
  const fk = (column: string, table: string, key: string) =>
    `foreign key (organization_id, ${column}) references ${s}.${table} (organization_id, ${key})`;
  return `
create table ${s}.frameworks (
  framework_id text primary key,
  organization_id text not null,
  code text not null,
  name text not null,
  edition text,
  kind text not null check (kind in ('standard', 'law', 'policy', 'customer', 'contract')),
  scope_unit_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, framework_id),
  unique (organization_id, code),
  ${fk('scope_unit_id', 'units', 'unit_id')}
);
${policy('frameworks')}

create table ${s}.requirements (
  requirement_id text primary key,
  organization_id text not null,
  framework_id text not null,
  reference text not null,
  summary text not null,
  unique (organization_id, requirement_id),
  unique (framework_id, reference),
  ${fk('framework_id', 'frameworks', 'framework_id')}
);
${policy('requirements')}

create table ${s}.controls (
  control_id text primary key,
  organization_id text not null,
  name text not null,
  description text not null,
  owner_position_id text,
  frequency_days integer not null check (frequency_days > 0),
  method text not null check (method in ('automatic', 'attestation')),
  check_key text,
  scope_unit_id text,
  created_at timestamptz not null default now(),
  check ((method = 'automatic') = (check_key is not null)),
  unique (organization_id, control_id),
  ${fk('owner_position_id', 'positions', 'position_id')},
  ${fk('scope_unit_id', 'units', 'unit_id')}
);
${policy('controls')}

create table ${s}.control_requirements (
  organization_id text not null,
  control_id text not null,
  requirement_id text not null,
  primary key (control_id, requirement_id),
  ${fk('control_id', 'controls', 'control_id')},
  ${fk('requirement_id', 'requirements', 'requirement_id')}
);
${policy('control_requirements')}

create table ${s}.evidence (
  evidence_id text primary key,
  organization_id text not null,
  control_id text not null,
  source text not null check (source in ('automatic', 'attestation')),
  outcome text not null check (outcome in ('pass', 'fail')),
  summary text not null,
  details jsonb not null default '{}',
  content_hash text not null,
  collected_by text not null,
  collected_at timestamptz not null default now(),
  valid_until date not null,
  ${fk('control_id', 'controls', 'control_id')}
);
create index evidence_latest on ${s}.evidence (organization_id, control_id, collected_at desc);
${policy('evidence')}

create table ${s}.documents (
  document_id text primary key,
  organization_id text not null,
  title text not null,
  kind text not null check (kind in ('policy', 'procedure', 'record')),
  created_at timestamptz not null default now(),
  unique (organization_id, document_id)
);
${policy('documents')}

create table ${s}.document_versions (
  organization_id text not null,
  document_id text not null,
  version integer not null check (version >= 1),
  content text not null,
  content_hash text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'obsolete')),
  written_by text not null,
  written_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  primary key (document_id, version),
  ${fk('document_id', 'documents', 'document_id')}
);
${policy('document_versions')}

create table ${s}.audits (
  audit_id text primary key,
  organization_id text not null,
  framework_id text,
  kind text not null check (kind in ('internal', 'external')),
  scope_unit_id text,
  planned_on date not null,
  status text not null default 'planned' check (status in ('planned', 'done')),
  conclusion text,
  unique (organization_id, audit_id),
  ${fk('framework_id', 'frameworks', 'framework_id')},
  ${fk('scope_unit_id', 'units', 'unit_id')}
);
${policy('audits')}

create table ${s}.findings (
  finding_id text primary key,
  organization_id text not null,
  audit_id text,
  control_id text,
  severity text not null check (severity in ('major', 'minor', 'observation')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  raised_by text not null,
  raised_at timestamptz not null default now(),
  check (audit_id is not null or control_id is not null),
  unique (organization_id, finding_id),
  ${fk('audit_id', 'audits', 'audit_id')},
  ${fk('control_id', 'controls', 'control_id')}
);
${policy('findings')}

create table ${s}.corrective_actions (
  action_id text primary key,
  organization_id text not null,
  finding_id text not null,
  description text not null,
  owner_user_id text not null,
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'done', 'verified')),
  done_by text,
  done_at timestamptz,
  verified_by text,
  verified_at timestamptz,
  ${fk('finding_id', 'findings', 'finding_id')}
);
${policy('corrective_actions')}

create table ${s}.certificates (
  certificate_id text primary key,
  organization_id text not null,
  framework_id text not null,
  body text not null,
  number text not null,
  scope_unit_id text,
  issued_on date not null,
  expires_on date not null,
  next_surveillance_on date,
  check (expires_on > issued_on),
  ${fk('framework_id', 'frameworks', 'framework_id')},
  ${fk('scope_unit_id', 'units', 'unit_id')}
);
${policy('certificates')}

grant select, insert, update on ${s}.frameworks, ${s}.requirements, ${s}.controls,
  ${s}.documents, ${s}.document_versions, ${s}.audits, ${s}.findings, ${s}.corrective_actions,
  ${s}.certificates to ${app};
grant select, insert on ${s}.control_requirements to ${app};
-- Evidence is never changed nor deleted: a newer one supersedes it. Whatever a schema's default
-- privileges give, the application role keeps reading and adding only.
revoke all on ${s}.evidence from ${app};
grant select, insert on ${s}.evidence to ${app};
`;
}

/** A stable fingerprint of what the evidence says. */
export function fingerprint(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(',')}}`;
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}

const asDay = (column: string) => `to_char(${column}, 'YYYY-MM-DD') as ${column}`;
const asIso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export async function insertFramework(
  db: SqlExecutor,
  organizationId: string,
  input: {
    code: string;
    name: string;
    edition?: string | undefined;
    kind: string;
    scopeUnitId?: string | undefined;
  },
) {
  const frameworkId = newId('fwk');
  await db.query(
    `insert into frameworks (framework_id, organization_id, code, name, edition, kind, scope_unit_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      frameworkId,
      organizationId,
      input.code,
      input.name,
      input.edition ?? null,
      input.kind,
      input.scopeUnitId ?? null,
    ],
  );
  return { frameworkId };
}

export async function insertRequirement(
  db: SqlExecutor,
  organizationId: string,
  input: { frameworkId: string; reference: string; summary: string },
) {
  const requirementId = newId('req');
  await db.query(
    `insert into requirements (requirement_id, organization_id, framework_id, reference, summary)
     values ($1, $2, $3, $4, $5)`,
    [requirementId, organizationId, input.frameworkId, input.reference, input.summary],
  );
  return { requirementId };
}

export async function insertControl(
  db: SqlExecutor,
  organizationId: string,
  input: {
    name: string;
    description: string;
    ownerPositionId?: string | undefined;
    frequencyDays: number;
    method: string;
    check?: string | undefined;
    scopeUnitId?: string | undefined;
  },
) {
  const controlId = newId('ctl');
  await db.query(
    `insert into controls (control_id, organization_id, name, description, owner_position_id,
       frequency_days, method, check_key, scope_unit_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      controlId,
      organizationId,
      input.name,
      input.description,
      input.ownerPositionId ?? null,
      input.frequencyDays,
      input.method,
      input.check ?? null,
      input.scopeUnitId ?? null,
    ],
  );
  return { controlId };
}

export async function linkControl(
  db: SqlExecutor,
  organizationId: string,
  controlId: string,
  requirementId: string,
) {
  await db.query(
    `insert into control_requirements (organization_id, control_id, requirement_id)
     values ($1, $2, $3) on conflict do nothing`,
    [organizationId, controlId, requirementId],
  );
}

export interface ControlRow {
  controlId: string;
  name: string;
  description: string;
  ownerPositionId: string | null;
  frequencyDays: number;
  method: 'automatic' | 'attestation';
  check: string | null;
  scopeUnitId: string | null;
}

export async function findControl(db: SqlExecutor, controlId: string): Promise<ControlRow | null> {
  const { rows } = await db.query<{
    control_id: string;
    name: string;
    description: string;
    owner_position_id: string | null;
    frequency_days: number;
    method: 'automatic' | 'attestation';
    check_key: string | null;
    scope_unit_id: string | null;
  }>(
    `select control_id, name, description, owner_position_id, frequency_days, method, check_key,
            scope_unit_id
       from controls where control_id = $1`,
    [controlId],
  );
  const r = rows[0];
  return r
    ? {
        controlId: r.control_id,
        name: r.name,
        description: r.description,
        ownerPositionId: r.owner_position_id,
        frequencyDays: r.frequency_days,
        method: r.method,
        check: r.check_key,
        scopeUnitId: r.scope_unit_id,
      }
    : null;
}

export async function insertEvidence(
  db: SqlExecutor,
  organizationId: string,
  input: {
    controlId: string;
    source: 'automatic' | 'attestation';
    outcome: 'pass' | 'fail';
    summary: string;
    details: Record<string, unknown>;
    collectedBy: string;
    frequencyDays: number;
  },
) {
  const evidenceId = newId('evd');
  const contentHash = fingerprint({
    controlId: input.controlId,
    outcome: input.outcome,
    summary: input.summary,
    details: input.details,
  });
  const { rows } = await db.query<{ valid_until: string; collected_at: Date }>(
    `insert into evidence (evidence_id, organization_id, control_id, source, outcome, summary,
       details, content_hash, collected_by, valid_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, current_date + $10::integer)
     returning ${asDay('valid_until')}, collected_at`,
    [
      evidenceId,
      organizationId,
      input.controlId,
      input.source,
      input.outcome,
      input.summary,
      JSON.stringify(input.details),
      contentHash,
      input.collectedBy,
      input.frequencyDays,
    ],
  );
  return { evidenceId, contentHash, validUntil: rows[0]?.valid_until ?? '' };
}

/** Whether a person holds the control's owner position today. */
export async function holdsPosition(
  db: SqlExecutor,
  accountUserId: string,
  positionId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from assignments a join people pe on pe.person_id = a.person_id
      where a.position_id = $1 and pe.account_user_id = $2
        and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)`,
    [positionId, accountUserId],
  );
  return rows.length > 0;
}

export async function writeDocument(
  db: SqlExecutor,
  organizationId: string,
  input: {
    documentId?: string | undefined;
    title: string;
    kind: string;
    content: string;
    writtenBy: string;
  },
): Promise<{ documentId: string; version: number } | null> {
  let documentId = input.documentId;
  if (!documentId) {
    documentId = newId('doc');
    await db.query(
      `insert into documents (document_id, organization_id, title, kind) values ($1, $2, $3, $4)`,
      [documentId, organizationId, input.title, input.kind],
    );
  } else {
    const { rows } = await db.query(`select 1 from documents where document_id = $1 for update`, [
      documentId,
    ]);
    if (rows.length === 0) return null;
    await db.query(`update documents set title = $2 where document_id = $1`, [
      documentId,
      input.title,
    ]);
  }
  const { rows } = await db.query<{ version: number }>(
    `insert into document_versions (organization_id, document_id, version, content, content_hash,
       written_by)
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5 from document_versions
      where document_id = $2
     returning version`,
    [organizationId, documentId, input.content, fingerprint(input.content), input.writtenBy],
  );
  return { documentId, version: rows[0]?.version ?? 1 };
}

export async function findVersion(db: SqlExecutor, documentId: string, version: number) {
  const { rows } = await db.query<{ status: string; written_by: string }>(
    `select status, written_by from document_versions where document_id = $1 and version = $2`,
    [documentId, version],
  );
  return rows[0] ?? null;
}

/** The version becomes current; the one approved before becomes obsolete. */
export async function approveVersion(
  db: SqlExecutor,
  documentId: string,
  version: number,
  approvedBy: string,
) {
  await db.query(
    `update document_versions set status = 'obsolete' where document_id = $1 and status = 'approved'`,
    [documentId],
  );
  await db.query(
    `update document_versions set status = 'approved', approved_by = $3, approved_at = now()
      where document_id = $1 and version = $2`,
    [documentId, version, approvedBy],
  );
}

export async function insertAudit(
  db: SqlExecutor,
  organizationId: string,
  input: {
    frameworkId?: string | undefined;
    kind: string;
    scopeUnitId?: string | undefined;
    plannedOn: string;
  },
) {
  const auditId = newId('aud');
  await db.query(
    `insert into audits (audit_id, organization_id, framework_id, kind, scope_unit_id, planned_on)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      auditId,
      organizationId,
      input.frameworkId ?? null,
      input.kind,
      input.scopeUnitId ?? null,
      input.plannedOn,
    ],
  );
  return { auditId };
}

export async function concludeAudit(db: SqlExecutor, auditId: string, conclusion: string) {
  const { rows } = await db.query(
    `update audits set status = 'done', conclusion = $2 where audit_id = $1 returning audit_id`,
    [auditId, conclusion],
  );
  return rows.length > 0;
}

export async function insertFinding(
  db: SqlExecutor,
  organizationId: string,
  input: {
    auditId?: string | undefined;
    controlId?: string | undefined;
    severity: string;
    description: string;
    raisedBy: string;
  },
) {
  const findingId = newId('fnd');
  await db.query(
    `insert into findings (finding_id, organization_id, audit_id, control_id, severity,
       description, raised_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      findingId,
      organizationId,
      input.auditId ?? null,
      input.controlId ?? null,
      input.severity,
      input.description,
      input.raisedBy,
    ],
  );
  return { findingId };
}

export async function insertAction(
  db: SqlExecutor,
  organizationId: string,
  input: { findingId: string; description: string; ownerUserId: string; dueOn: string },
) {
  const actionId = newId('cac');
  await db.query(
    `insert into corrective_actions (action_id, organization_id, finding_id, description,
       owner_user_id, due_on)
     values ($1, $2, $3, $4, $5, $6)`,
    [actionId, organizationId, input.findingId, input.description, input.ownerUserId, input.dueOn],
  );
  return { actionId };
}

export async function findAction(db: SqlExecutor, actionId: string) {
  const { rows } = await db.query<{
    finding_id: string;
    owner_user_id: string;
    status: 'open' | 'done' | 'verified';
    done_by: string | null;
  }>(
    `select finding_id, owner_user_id, status, done_by from corrective_actions
      where action_id = $1 for update`,
    [actionId],
  );
  return rows[0] ?? null;
}

export async function markActionDone(db: SqlExecutor, actionId: string, by: string) {
  await db.query(
    `update corrective_actions set status = 'done', done_by = $2, done_at = now() where action_id = $1`,
    [actionId, by],
  );
}

/** Verifies an action; its finding closes when every one of its actions is verified. */
export async function markActionVerified(db: SqlExecutor, actionId: string, by: string) {
  const { rows } = await db.query<{ finding_id: string }>(
    `update corrective_actions set status = 'verified', verified_by = $2, verified_at = now()
      where action_id = $1 returning finding_id`,
    [actionId, by],
  );
  const findingId = rows[0]?.finding_id;
  if (!findingId) return false;
  const { rows: left } = await db.query(
    `select 1 from corrective_actions where finding_id = $1 and status <> 'verified'`,
    [findingId],
  );
  if (left.length === 0) {
    await db.query(`update findings set status = 'closed' where finding_id = $1`, [findingId]);
    return true;
  }
  return false;
}

export async function insertCertificate(
  db: SqlExecutor,
  organizationId: string,
  input: {
    frameworkId: string;
    body: string;
    number: string;
    scopeUnitId?: string | undefined;
    issuedOn: string;
    expiresOn: string;
    nextSurveillanceOn?: string | undefined;
  },
) {
  const certificateId = newId('crt');
  await db.query(
    `insert into certificates (certificate_id, organization_id, framework_id, body, number,
       scope_unit_id, issued_on, expires_on, next_surveillance_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      certificateId,
      organizationId,
      input.frameworkId,
      input.body,
      input.number,
      input.scopeUnitId ?? null,
      input.issuedOn,
      input.expiresOn,
      input.nextSurveillanceOn ?? null,
    ],
  );
  return { certificateId };
}

/** Everything compliance holds, for the overview (the person's rights are checked by the caller). */
export async function readCompliance(db: SqlExecutor) {
  const q = async <T extends Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
  const [
    frameworks,
    requirements,
    controls,
    links,
    latest,
    documents,
    versions,
    audits,
    findings,
    actions,
    certificates,
  ] = await Promise.all([
    q<{
      framework_id: string;
      code: string;
      name: string;
      edition: string | null;
      kind: string;
      scope_unit_id: string | null;
    }>(
      `select framework_id, code, name, edition, kind, scope_unit_id from frameworks order by name`,
    ),
    q<{ requirement_id: string; framework_id: string; reference: string; summary: string }>(
      `select requirement_id, framework_id, reference, summary from requirements order by reference`,
    ),
    q<{
      control_id: string;
      name: string;
      description: string;
      owner_position_id: string | null;
      frequency_days: number;
      method: string;
      check_key: string | null;
      scope_unit_id: string | null;
    }>(
      `select control_id, name, description, owner_position_id, frequency_days, method, check_key,
                scope_unit_id from controls order by name`,
    ),
    q<{ control_id: string; requirement_id: string }>(
      `select control_id, requirement_id from control_requirements`,
    ),
    q<{
      control_id: string;
      evidence_id: string;
      source: string;
      outcome: 'pass' | 'fail';
      summary: string;
      content_hash: string;
      collected_by: string;
      collected_at: Date;
      valid_until: string;
    }>(
      `select distinct on (control_id) control_id, evidence_id, source, outcome, summary,
                content_hash, collected_by, collected_at, ${asDay('valid_until')}
           from evidence order by control_id, collected_at desc`,
    ),
    q<{ document_id: string; title: string; kind: string }>(
      `select document_id, title, kind from documents order by title`,
    ),
    q<{
      document_id: string;
      version: number;
      status: string;
      content_hash: string;
      written_by: string;
      approved_by: string | null;
    }>(
      `select document_id, version, status, content_hash, written_by, approved_by
           from document_versions order by document_id, version`,
    ),
    q<{
      audit_id: string;
      framework_id: string | null;
      kind: string;
      scope_unit_id: string | null;
      planned_on: string;
      status: string;
      conclusion: string | null;
    }>(
      `select audit_id, framework_id, kind, scope_unit_id, ${asDay('planned_on')}, status, conclusion
           from audits order by planned_on desc`,
    ),
    q<{
      finding_id: string;
      audit_id: string | null;
      control_id: string | null;
      severity: string;
      description: string;
      status: string;
    }>(
      `select finding_id, audit_id, control_id, severity, description, status from findings
          order by raised_at desc`,
    ),
    q<{
      action_id: string;
      finding_id: string;
      description: string;
      owner_user_id: string;
      due_on: string;
      status: string;
      done_by: string | null;
      verified_by: string | null;
    }>(
      `select action_id, finding_id, description, owner_user_id, ${asDay('due_on')}, status, done_by,
                verified_by from corrective_actions order by due_on`,
    ),
    q<{
      certificate_id: string;
      framework_id: string;
      body: string;
      number: string;
      scope_unit_id: string | null;
      issued_on: string;
      expires_on: string;
      next_surveillance_on: string | null;
    }>(
      `select certificate_id, framework_id, body, number, scope_unit_id, ${asDay('issued_on')},
                ${asDay('expires_on')}, ${asDay('next_surveillance_on')} from certificates order by expires_on`,
    ),
  ]);
  return {
    frameworks: frameworks.map((f) => ({
      frameworkId: f.framework_id,
      code: f.code,
      name: f.name,
      edition: f.edition,
      kind: f.kind,
      scopeUnitId: f.scope_unit_id,
    })),
    requirements: requirements.map((r) => ({
      requirementId: r.requirement_id,
      frameworkId: r.framework_id,
      reference: r.reference,
      summary: r.summary,
    })),
    controls: controls.map((c) => ({
      controlId: c.control_id,
      name: c.name,
      description: c.description,
      ownerPositionId: c.owner_position_id,
      frequencyDays: c.frequency_days,
      method: c.method as 'automatic' | 'attestation',
      check: c.check_key,
      scopeUnitId: c.scope_unit_id,
    })),
    links: links.map((l) => ({ controlId: l.control_id, requirementId: l.requirement_id })),
    latest: latest.map((e) => ({
      controlId: e.control_id,
      evidenceId: e.evidence_id,
      source: e.source,
      outcome: e.outcome,
      summary: e.summary,
      contentHash: e.content_hash,
      collectedBy: e.collected_by,
      collectedAt: asIso(e.collected_at) ?? '',
      validUntil: e.valid_until,
    })),
    documents: documents.map((d) => ({
      documentId: d.document_id,
      title: d.title,
      kind: d.kind,
      versions: versions
        .filter((v) => v.document_id === d.document_id)
        .map((v) => ({
          version: v.version,
          status: v.status,
          contentHash: v.content_hash,
          writtenBy: v.written_by,
          approvedBy: v.approved_by,
        })),
    })),
    audits: audits.map((a) => ({
      auditId: a.audit_id,
      frameworkId: a.framework_id,
      kind: a.kind,
      scopeUnitId: a.scope_unit_id,
      plannedOn: a.planned_on,
      status: a.status,
      conclusion: a.conclusion,
    })),
    findings: findings.map((f) => ({
      findingId: f.finding_id,
      auditId: f.audit_id,
      controlId: f.control_id,
      severity: f.severity,
      description: f.description,
      status: f.status,
      actions: actions
        .filter((a) => a.finding_id === f.finding_id)
        .map((a) => ({
          actionId: a.action_id,
          description: a.description,
          ownerUserId: a.owner_user_id,
          dueOn: a.due_on,
          status: a.status,
          doneBy: a.done_by,
          verifiedBy: a.verified_by,
        })),
    })),
    certificates: certificates.map((c) => ({
      certificateId: c.certificate_id,
      frameworkId: c.framework_id,
      body: c.body,
      number: c.number,
      scopeUnitId: c.scope_unit_id,
      issuedOn: c.issued_on,
      expiresOn: c.expires_on,
      nextSurveillanceOn: c.next_surveillance_on,
    })),
  };
}
