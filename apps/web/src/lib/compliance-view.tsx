import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { changeCompliance, type ComplianceScreen, type ControlStatus } from './compliance';
import { GestureForm, optional, refusal, Select } from './forms';

export function StatusTag({ status }: { status: ControlStatus }) {
  const label = {
    passing: m.control_passing,
    failing: m.control_failing,
    expired: m.control_expired,
    missing: m.control_missing,
  }[status]();
  const tone = status === 'passing' ? 'validated' : status === 'failing' ? 'error' : 'verify';
  return <Tag tone={tone}>{label}</Tag>;
}

export function checkLabel(check: string): string {
  const labels: Record<string, () => string> = {
    'registry.apps_have_card': m.check_registry_apps_have_card,
    'decisions.no_overdue': m.check_decisions_no_overdue,
    'agents.act_for_someone': m.check_agents_act_for_someone,
    'structure.positions_filled': m.check_structure_positions_filled,
    'compliance.actions_on_time': m.check_compliance_actions_on_time,
  };
  return labels[check]?.() ?? check;
}

const severities: Record<string, () => string> = {
  major: m.severity_major,
  minor: m.severity_minor,
  observation: m.severity_observation,
};
const severityLabel = (s: string) => severities[s]?.() ?? s;

function useGesture() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const send = (path: string, body: object = {}) => {
    setError(null);
    void changeCompliance({ data: { path, body, key: crypto.randomUUID() } }).then(
      async (answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        await router.invalidate();
      },
    );
  };
  const alert = error ? (
    <p role="alert" className="text-body-sm text-state-error-fg">
      {error}
    </p>
  ) : null;
  return { send, alert };
}

const sendForm = (path: string, body: object) => (key: string) =>
  changeCompliance({ data: { path, body, key } });

function Frameworks({ screen }: { screen: ComplianceScreen }) {
  const [framework, setFramework] = useState({ code: '', name: '', edition: '', kind: 'standard' });
  const [requirement, setRequirement] = useState({ frameworkId: '', reference: '', summary: '' });
  return (
    <div className="grid gap-6">
      {screen.frameworks.length === 0 && <p className="text-fg-muted">{m.frameworks_none()}</p>}
      {screen.frameworks.map((f) => (
        <Panel key={f.frameworkId} title={`${f.name}${f.edition ? ` (${f.edition})` : ''}`}>
          <ul className="grid gap-3">
            {f.requirements.map((r) => (
              <li key={r.requirementId} className="grid gap-1">
                <p>
                  <span className="font-mono font-semibold">{r.reference}</span> {r.summary}
                </p>
                <div className="flex flex-wrap gap-2 text-body-sm">
                  {r.controls.length === 0 ? (
                    <Tag tone="verify">{m.requirement_no_control()}</Tag>
                  ) : (
                    r.controls.map((c) => (
                      <span key={c.controlId} className="flex items-center gap-1">
                        {c.name} <StatusTag status={c.status} />
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
          {f.certificates.map((c) => (
            <p key={c.certificateId} className="mt-3 text-body-sm text-fg-muted">
              {m.certificate_line({ body: c.body, number: c.number, expires: c.expiresOn })}
            </p>
          ))}
        </Panel>
      ))}
      <div className="grid gap-6 md:grid-cols-2">
        <GestureForm
          title={m.framework_new()}
          ready={framework.code.trim() !== '' && framework.name.trim() !== ''}
          send={sendForm('/frameworks', { ...framework, edition: optional(framework.edition) })}
          onDone={() => setFramework({ code: '', name: '', edition: '', kind: 'standard' })}
        >
          <TextField
            label={m.field_name()}
            value={framework.name}
            required
            onChange={(e) => setFramework({ ...framework, name: e.target.value })}
          />
          <TextField
            label={m.framework_code()}
            hint={m.framework_code_hint()}
            value={framework.code}
            required
            onChange={(e) => setFramework({ ...framework, code: e.target.value })}
          />
          <TextField
            label={m.framework_edition()}
            value={framework.edition}
            onChange={(e) => setFramework({ ...framework, edition: e.target.value })}
          />
          <Select
            label={m.framework_kind()}
            value={framework.kind}
            onChange={(e) => setFramework({ ...framework, kind: e.target.value })}
          >
            {(['standard', 'law', 'policy', 'customer', 'contract'] as const).map((k) => (
              <option key={k} value={k}>
                {{
                  standard: m.fkind_standard,
                  law: m.fkind_law,
                  policy: m.fkind_policy,
                  customer: m.fkind_customer,
                  contract: m.fkind_contract,
                }[k]()}
              </option>
            ))}
          </Select>
        </GestureForm>
        <GestureForm
          title={m.requirement_new()}
          ready={
            requirement.frameworkId !== '' &&
            requirement.reference.trim() !== '' &&
            requirement.summary.trim() !== ''
          }
          send={sendForm('/requirements', requirement)}
          onDone={() => setRequirement({ ...requirement, reference: '', summary: '' })}
        >
          <Select
            label={m.requirement_framework()}
            value={requirement.frameworkId}
            onChange={(e) => setRequirement({ ...requirement, frameworkId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {screen.frameworks.map((f) => (
              <option key={f.frameworkId} value={f.frameworkId}>
                {f.name}
              </option>
            ))}
          </Select>
          <TextField
            label={m.requirement_reference()}
            value={requirement.reference}
            required
            onChange={(e) => setRequirement({ ...requirement, reference: e.target.value })}
          />
          <TextField
            label={m.requirement_summary()}
            hint={m.requirement_summary_hint()}
            value={requirement.summary}
            required
            onChange={(e) => setRequirement({ ...requirement, summary: e.target.value })}
          />
        </GestureForm>
      </div>
    </div>
  );
}

function ControlRow({ control }: { control: ComplianceScreen['controls'][number] }) {
  const { send, alert } = useGesture();
  const [summary, setSummary] = useState('');
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{control.name}</span>
        <StatusTag status={control.status} />
        <Tag>
          {control.method === 'automatic'
            ? checkLabel(control.check ?? '')
            : m.method_attestation()}
        </Tag>
      </div>
      <p className="text-body-sm text-fg-muted">{control.description}</p>
      {control.evidence && (
        <p className="text-body-sm text-fg-muted">
          {m.evidence_line({
            outcome: control.evidence.outcome === 'pass' ? m.outcome_pass() : m.outcome_fail(),
            date: control.evidence.collectedAt.slice(0, 10),
            until: control.evidence.validUntil,
            hash: control.evidence.contentHash.slice(0, 12),
          })}
        </p>
      )}
      {control.method === 'automatic' ? (
        <div>
          <Button
            variant="secondary"
            onClick={() => send(`/controls/${control.controlId}/collect`)}
          >
            {m.evidence_collect()}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            className="min-w-72"
            label={m.evidence_summary()}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <Button
            disabled={!summary.trim()}
            onClick={() =>
              send(`/controls/${control.controlId}/attest`, { outcome: 'pass', summary })
            }
          >
            {m.attest_pass()}
          </Button>
          <Button
            variant="secondary"
            disabled={!summary.trim()}
            onClick={() =>
              send(`/controls/${control.controlId}/attest`, { outcome: 'fail', summary })
            }
          >
            {m.attest_fail()}
          </Button>
        </div>
      )}
      {alert}
    </li>
  );
}

function Controls({ screen }: { screen: ComplianceScreen }) {
  const unitName = new Map(screen.chart.units.map((u) => [u.unitId, u.name]));
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    method: 'attestation' as 'automatic' | 'attestation',
    check: '',
    frequencyDays: '90',
    ownerPositionId: '',
    requirementIds: [] as string[],
  });
  const requirements = screen.frameworks.flatMap((f) =>
    f.requirements.map((r) => ({ ...r, framework: f.name })),
  );
  return (
    <div className="grid gap-6">
      <Panel title={m.controls_title()}>
        {screen.controls.length === 0 ? (
          <p className="text-fg-muted">{m.controls_none()}</p>
        ) : (
          <ul>
            {screen.controls.map((c) => (
              <ControlRow key={c.controlId} control={c} />
            ))}
          </ul>
        )}
      </Panel>
      <GestureForm
        title={m.control_new()}
        ready={
          draft.name.trim() !== '' &&
          draft.description.trim() !== '' &&
          (draft.method === 'attestation' || draft.check !== '')
        }
        send={sendForm('/controls', {
          name: draft.name,
          description: draft.description,
          method: draft.method,
          ...(draft.method === 'automatic' ? { check: draft.check } : {}),
          frequencyDays: Number(draft.frequencyDays) || 90,
          ...(draft.ownerPositionId ? { ownerPositionId: draft.ownerPositionId } : {}),
          requirementIds: draft.requirementIds,
        })}
        onDone={() => setDraft({ ...draft, name: '', description: '', requirementIds: [] })}
      >
        <TextField
          label={m.field_name()}
          value={draft.name}
          required
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <TextField
          label={m.field_description()}
          value={draft.description}
          required
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <Select
          label={m.control_method()}
          value={draft.method}
          onChange={(e) =>
            setDraft({ ...draft, method: e.target.value as 'automatic' | 'attestation' })
          }
        >
          <option value="attestation">{m.method_attestation()}</option>
          <option value="automatic">{m.method_automatic()}</option>
        </Select>
        {draft.method === 'automatic' && (
          <Select
            label={m.control_check()}
            value={draft.check}
            onChange={(e) => setDraft({ ...draft, check: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {screen.checks.map((c) => (
              <option key={c} value={c}>
                {checkLabel(c)}
              </option>
            ))}
          </Select>
        )}
        <TextField
          label={m.control_frequency()}
          type="number"
          min={1}
          value={draft.frequencyDays}
          onChange={(e) => setDraft({ ...draft, frequencyDays: e.target.value })}
        />
        <Select
          label={m.control_owner()}
          value={draft.ownerPositionId}
          onChange={(e) => setDraft({ ...draft, ownerPositionId: e.target.value })}
        >
          <option value="">{m.field_nobody()}</option>
          {screen.chart.positions.map((p) => (
            <option key={p.positionId} value={p.positionId}>
              {`${p.title} · ${unitName.get(p.unitId) ?? ''}`}
            </option>
          ))}
        </Select>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-semibold">{m.control_requirements()}</legend>
          {requirements.map((r) => (
            <label key={r.requirementId} className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={draft.requirementIds.includes(r.requirementId)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    requirementIds: e.target.checked
                      ? [...draft.requirementIds, r.requirementId]
                      : draft.requirementIds.filter((x) => x !== r.requirementId),
                  })
                }
              />
              {`${r.framework} · ${r.reference}`}
            </label>
          ))}
        </fieldset>
      </GestureForm>
    </div>
  );
}

function Documents({ screen }: { screen: ComplianceScreen }) {
  const { send, alert } = useGesture();
  const [draft, setDraft] = useState({ documentId: '', title: '', kind: 'policy', content: '' });
  const statuses: Record<string, () => string> = {
    draft: m.doc_draft,
    approved: m.doc_approved,
    obsolete: m.doc_obsolete,
  };
  const statusLabel = (s: string) => statuses[s]?.() ?? s;
  return (
    <div className="grid gap-6">
      <Panel title={m.documents_title()}>
        {screen.documents.length === 0 ? (
          <p className="text-fg-muted">{m.documents_none()}</p>
        ) : (
          <ul className="grid gap-3">
            {screen.documents.map((d) => (
              <li key={d.documentId} className="grid gap-1">
                <span className="font-semibold">{d.title}</span>
                <div className="flex flex-wrap gap-2 text-body-sm">
                  {d.versions.map((v) => (
                    <span key={v.version} className="flex items-center gap-1">
                      {`v${v.version}`}{' '}
                      <Tag tone={v.status === 'approved' ? 'validated' : 'neutral'}>
                        {statusLabel(v.status)}
                      </Tag>
                      {v.status === 'draft' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            send(`/documents/${d.documentId}/approve`, { version: v.version })
                          }
                        >
                          {m.approve()}
                        </Button>
                      )}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {alert}
      </Panel>
      <GestureForm
        title={m.document_write()}
        ready={draft.title.trim() !== '' && draft.content.trim() !== ''}
        send={sendForm('/documents', {
          ...(draft.documentId ? { documentId: draft.documentId } : {}),
          title: draft.title,
          kind: draft.kind,
          content: draft.content,
        })}
        onDone={() => setDraft({ documentId: '', title: '', kind: 'policy', content: '' })}
      >
        <Select
          label={m.document_which()}
          value={draft.documentId}
          onChange={(e) => {
            const doc = screen.documents.find((d) => d.documentId === e.target.value);
            setDraft({
              ...draft,
              documentId: e.target.value,
              title: doc?.title ?? draft.title,
              kind: doc?.kind ?? draft.kind,
            });
          }}
        >
          <option value="">{m.document_new()}</option>
          {screen.documents.map((d) => (
            <option key={d.documentId} value={d.documentId}>
              {d.title}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_title()}
          value={draft.title}
          required
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <Select
          label={m.document_kind()}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
        >
          <option value="policy">{m.dkind_policy()}</option>
          <option value="procedure">{m.dkind_procedure()}</option>
          <option value="record">{m.dkind_record()}</option>
        </Select>
        <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
          {m.document_content()}
          <textarea
            className="min-h-40 rounded-control border border-line-control bg-surface-control p-3 font-normal text-fg"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
        </label>
      </GestureForm>
    </div>
  );
}

function Audits({ screen }: { screen: ComplianceScreen }) {
  const { send, alert } = useGesture();
  const [audit, setAudit] = useState({
    frameworkId: '',
    kind: 'internal',
    plannedOn: screen.today,
  });
  const [conclusion, setConclusion] = useState({ auditId: '', conclusion: '' });
  const [finding, setFinding] = useState({
    auditId: '',
    controlId: '',
    severity: 'minor',
    description: '',
  });
  const [action, setAction] = useState({
    findingId: '',
    description: '',
    ownerUserId: '',
    dueOn: screen.today,
  });
  const accounts = screen.chart.people.filter((p) => p.accountUserId);
  const nameOf = new Map(accounts.map((p) => [p.accountUserId, p.name]));
  return (
    <div className="grid gap-6">
      <Panel title={m.findings_title()}>
        {screen.findings.length === 0 ? (
          <p className="text-fg-muted">{m.findings_none()}</p>
        ) : (
          <ul className="grid gap-3">
            {screen.findings.map((f) => (
              <li key={f.findingId} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={f.severity === 'major' ? 'error' : 'verify'}>
                    {severityLabel(f.severity)}
                  </Tag>
                  <span>{f.description}</span>
                  <Tag>{f.status === 'closed' ? m.finding_closed() : m.finding_open()}</Tag>
                </div>
                <ul className="ml-4 grid gap-1 text-body-sm">
                  {f.actions.map((a) => (
                    <li key={a.actionId} className="flex flex-wrap items-center gap-2">
                      <span>{a.description}</span>
                      <span className="text-fg-muted">{`${nameOf.get(a.ownerUserId) ?? a.ownerUserId} · ${a.dueOn}`}</span>
                      <Tag>
                        {{ open: m.action_open, done: m.action_done, verified: m.action_verified }[
                          a.status as 'open'
                        ]?.() ?? a.status}
                      </Tag>
                      {a.status === 'open' && a.ownerUserId === screen.me && (
                        <Button
                          variant="secondary"
                          onClick={() => send(`/actions/${a.actionId}/complete`)}
                        >
                          {m.action_complete()}
                        </Button>
                      )}
                      {a.status === 'done' && (
                        <Button
                          variant="secondary"
                          onClick={() => send(`/actions/${a.actionId}/verify`)}
                        >
                          {m.action_verify()}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {alert}
      </Panel>
      <div className="grid gap-6 md:grid-cols-2">
        <GestureForm
          title={m.audit_plan()}
          ready={audit.plannedOn !== ''}
          send={sendForm('/audits', {
            kind: audit.kind,
            plannedOn: audit.plannedOn,
            ...(audit.frameworkId ? { frameworkId: audit.frameworkId } : {}),
          })}
          onDone={() => setAudit({ ...audit })}
        >
          <Select
            label={m.requirement_framework()}
            value={audit.frameworkId}
            onChange={(e) => setAudit({ ...audit, frameworkId: e.target.value })}
          >
            <option value="">{m.field_nobody()}</option>
            {screen.frameworks.map((f) => (
              <option key={f.frameworkId} value={f.frameworkId}>
                {f.name}
              </option>
            ))}
          </Select>
          <Select
            label={m.audit_kind()}
            value={audit.kind}
            onChange={(e) => setAudit({ ...audit, kind: e.target.value })}
          >
            <option value="internal">{m.audit_internal()}</option>
            <option value="external">{m.audit_external()}</option>
          </Select>
          <TextField
            label={m.audit_planned_on()}
            type="date"
            value={audit.plannedOn}
            onChange={(e) => setAudit({ ...audit, plannedOn: e.target.value })}
          />
        </GestureForm>
        <GestureForm
          title={m.audit_conclude()}
          ready={conclusion.auditId !== '' && conclusion.conclusion.trim() !== ''}
          send={sendForm(`/audits/${conclusion.auditId}/conclude`, {
            conclusion: conclusion.conclusion,
          })}
          onDone={() => setConclusion({ auditId: '', conclusion: '' })}
        >
          <Select
            label={m.audit_which()}
            value={conclusion.auditId}
            onChange={(e) => setConclusion({ ...conclusion, auditId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {screen.audits
              .filter((a) => a.status === 'planned')
              .map((a) => (
                <option key={a.auditId} value={a.auditId}>
                  {`${a.plannedOn} · ${a.kind === 'internal' ? m.audit_internal() : m.audit_external()}`}
                </option>
              ))}
          </Select>
          <TextField
            label={m.audit_conclusion()}
            value={conclusion.conclusion}
            onChange={(e) => setConclusion({ ...conclusion, conclusion: e.target.value })}
          />
        </GestureForm>
        <GestureForm
          title={m.finding_raise()}
          ready={
            (finding.auditId !== '' || finding.controlId !== '') &&
            finding.description.trim() !== ''
          }
          send={sendForm('/findings', {
            severity: finding.severity,
            description: finding.description,
            ...(finding.auditId ? { auditId: finding.auditId } : {}),
            ...(finding.controlId ? { controlId: finding.controlId } : {}),
          })}
          onDone={() => setFinding({ ...finding, description: '' })}
        >
          <Select
            label={m.audit_which()}
            value={finding.auditId}
            onChange={(e) => setFinding({ ...finding, auditId: e.target.value })}
          >
            <option value="">{m.field_nobody()}</option>
            {screen.audits.map((a) => (
              <option key={a.auditId} value={a.auditId}>
                {a.plannedOn}
              </option>
            ))}
          </Select>
          <Select
            label={m.finding_control()}
            value={finding.controlId}
            onChange={(e) => setFinding({ ...finding, controlId: e.target.value })}
          >
            <option value="">{m.field_nobody()}</option>
            {screen.controls.map((c) => (
              <option key={c.controlId} value={c.controlId}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label={m.finding_severity()}
            value={finding.severity}
            onChange={(e) => setFinding({ ...finding, severity: e.target.value })}
          >
            {['major', 'minor', 'observation'].map((s) => (
              <option key={s} value={s}>
                {severityLabel(s)}
              </option>
            ))}
          </Select>
          <TextField
            label={m.field_description()}
            value={finding.description}
            onChange={(e) => setFinding({ ...finding, description: e.target.value })}
          />
        </GestureForm>
        <GestureForm
          title={m.action_assign()}
          ready={
            action.findingId !== '' && action.description.trim() !== '' && action.ownerUserId !== ''
          }
          send={sendForm('/actions', action)}
          onDone={() => setAction({ ...action, description: '' })}
        >
          <Select
            label={m.action_finding()}
            value={action.findingId}
            onChange={(e) => setAction({ ...action, findingId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {screen.findings
              .filter((f) => f.status === 'open')
              .map((f) => (
                <option key={f.findingId} value={f.findingId}>
                  {f.description}
                </option>
              ))}
          </Select>
          <TextField
            label={m.field_description()}
            value={action.description}
            onChange={(e) => setAction({ ...action, description: e.target.value })}
          />
          <Select
            label={m.action_owner()}
            value={action.ownerUserId}
            onChange={(e) => setAction({ ...action, ownerUserId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {accounts.map((p) => (
              <option key={p.personId} value={p.accountUserId ?? ''}>
                {p.name}
              </option>
            ))}
          </Select>
          <TextField
            label={m.action_due()}
            type="date"
            value={action.dueOn}
            onChange={(e) => setAction({ ...action, dueOn: e.target.value })}
          />
        </GestureForm>
      </div>
    </div>
  );
}

function Certificates({ screen }: { screen: ComplianceScreen }) {
  const [draft, setDraft] = useState({
    frameworkId: '',
    body: '',
    number: '',
    issuedOn: '',
    expiresOn: '',
  });
  return (
    <GestureForm
      title={m.certificate_record()}
      ready={
        draft.frameworkId !== '' &&
        draft.body.trim() !== '' &&
        draft.number.trim() !== '' &&
        draft.issuedOn !== '' &&
        draft.expiresOn !== ''
      }
      send={sendForm('/certificates', draft)}
      onDone={() =>
        setDraft({ frameworkId: '', body: '', number: '', issuedOn: '', expiresOn: '' })
      }
    >
      <Select
        label={m.requirement_framework()}
        value={draft.frameworkId}
        onChange={(e) => setDraft({ ...draft, frameworkId: e.target.value })}
      >
        <option value="">{m.field_choose()}</option>
        {screen.frameworks.map((f) => (
          <option key={f.frameworkId} value={f.frameworkId}>
            {f.name}
          </option>
        ))}
      </Select>
      <TextField
        label={m.certificate_body()}
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
      />
      <TextField
        label={m.certificate_number()}
        value={draft.number}
        onChange={(e) => setDraft({ ...draft, number: e.target.value })}
      />
      <TextField
        label={m.certificate_issued()}
        type="date"
        value={draft.issuedOn}
        onChange={(e) => setDraft({ ...draft, issuedOn: e.target.value })}
      />
      <TextField
        label={m.certificate_expires()}
        type="date"
        value={draft.expiresOn}
        onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })}
      />
    </GestureForm>
  );
}

export { Audits, Certificates, Controls, Documents, Frameworks };
