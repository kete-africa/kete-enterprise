import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { changeAgents, type AgentsScreen, type AgentView } from './agents';
import { GestureForm, refusal, Select } from './forms';
import { permissionLabel } from './rights-view';

export function signalLabel(kind: string): string {
  const labels: Record<string, () => string> = {
    'registry.no_card': m.signal_registry_no_card,
    'registry.no_owner': m.signal_registry_no_owner,
    'decisions.overdue': m.signal_decisions_overdue,
    'compliance.control_failing': m.signal_compliance_control_failing,
    'compliance.control_expired': m.signal_compliance_control_expired,
    'compliance.control_missing': m.signal_compliance_control_missing,
    'compliance.action_overdue': m.signal_compliance_action_overdue,
    'compliance.certificate_expiring': m.signal_compliance_certificate_expiring,
  };
  return labels[kind]?.() ?? kind;
}

function watchLabel(watch: string): string {
  const labels: Record<string, () => string> = {
    registry: m.watch_registry,
    decisions: m.watch_decisions,
    compliance: m.watch_compliance,
  };
  return labels[watch]?.() ?? watch;
}

function useGesture() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const send = (path: string, body: object = {}) => {
    setError(null);
    void changeAgents({ data: { path, body, key: crypto.randomUUID() } }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      await router.invalidate();
    });
  };
  return { error, send };
}

function AgentCard({ agent, unitName }: { agent: AgentView; unitName: Map<string, string> }) {
  const { error, send } = useGesture();
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <Panel title={agent.name}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="agent">{m.agent_level({ level: String(agent.autonomyMax) })}</Tag>
          <Tag tone={agent.status === 'active' ? 'validated' : 'neutral'}>
            {agent.status === 'active' ? m.agent_active() : m.agent_paused()}
          </Tag>
          {agent.watches.map((w) => (
            <Tag key={w}>{watchLabel(w)}</Tag>
          ))}
        </div>
        <p>{agent.mission}</p>
        <p className="text-body-sm text-fg-muted">
          {[
            agent.scopeUnitId
              ? m.agent_scope({ unit: unitName.get(agent.scopeUnitId) ?? '…' })
              : m.agent_scope_all(),
            agent.permissions.length > 0
              ? agent.permissions.map((p) => permissionLabel(p)).join(', ')
              : m.agent_no_permission(),
            m.agent_every({ minutes: String(agent.wakeEveryMinutes) }),
            agent.lastRunAt
              ? m.agent_last_run({ at: format.format(new Date(agent.lastRunAt)) })
              : m.agent_never_run(),
          ].join(' · ')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send(`/${agent.agentId}/wake`)}>
            {m.agent_wake()}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              send(`/${agent.agentId}/status`, {
                status: agent.status === 'active' ? 'paused' : 'active',
              })
            }
          >
            {agent.status === 'active' ? m.agent_pause() : m.agent_resume()}
          </Button>
        </div>
        <div>
          <h3 className="mb-2 text-body-sm font-semibold">{m.agent_signals()}</h3>
          {agent.signals.length === 0 ? (
            <p className="text-body-sm text-fg-muted">{m.agent_no_signal()}</p>
          ) : (
            <ul className="grid gap-2">
              {agent.signals.map((s) => (
                <li key={s.signalId} className="flex flex-wrap items-center gap-2 text-body-sm">
                  <Tag tone="verify">{signalLabel(s.kind)}</Tag>
                  <span className="font-semibold">{s.subject}</span>
                  <Button variant="secondary" onClick={() => send(`/signals/${s.signalId}/close`)}>
                    {m.agent_resolve()}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

export function AgentsView({ screen }: { screen: AgentsScreen }) {
  const unitName = new Map(screen.chart.units.map((u) => [u.unitId, u.name]));
  const [draft, setDraft] = useState({
    name: '',
    kind: 'personal' as AgentView['kind'],
    positionId: '',
    mission: '',
    scopeUnitId: '',
    permissions: [] as string[],
    watches: [] as string[],
    wakeEveryMinutes: '60',
  });
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((v) => v !== value);
  return (
    <div className="grid gap-6">
      {screen.agents.length === 0 ? (
        <p className="text-fg-muted">{m.agents_none()}</p>
      ) : (
        screen.agents.map((agent) => (
          <AgentCard key={agent.agentId} agent={agent} unitName={unitName} />
        ))
      )}
      <GestureForm
        title={m.agent_new()}
        ready={
          draft.name.trim() !== '' &&
          draft.mission.trim() !== '' &&
          draft.watches.length > 0 &&
          (draft.kind !== 'position' || draft.positionId !== '')
        }
        send={(key) =>
          changeAgents({
            data: {
              path: '/',
              body: {
                name: draft.name,
                kind: draft.kind,
                mission: draft.mission,
                ...(draft.kind === 'position' ? { positionId: draft.positionId } : {}),
                ...(draft.scopeUnitId ? { scopeUnitId: draft.scopeUnitId } : {}),
                permissions: draft.permissions,
                watches: draft.watches,
                wakeEveryMinutes: Number(draft.wakeEveryMinutes) || 60,
              },
              key,
            },
          })
        }
        onDone={() => setDraft({ ...draft, name: '', mission: '' })}
      >
        <TextField
          label={m.field_name()}
          value={draft.name}
          required
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <TextField
          label={m.agent_mission()}
          value={draft.mission}
          required
          onChange={(e) => setDraft({ ...draft, mission: e.target.value })}
        />
        <Select
          label={m.agent_kind()}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as AgentView['kind'] })}
        >
          <option value="personal">{m.agent_kind_personal()}</option>
          {screen.manages && <option value="position">{m.agent_kind_position()}</option>}
          {screen.manages && <option value="system">{m.agent_kind_system()}</option>}
        </Select>
        {draft.kind === 'position' && (
          <Select
            label={m.field_position()}
            value={draft.positionId}
            onChange={(e) => setDraft({ ...draft, positionId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {screen.chart.positions.map((p) => (
              <option key={p.positionId} value={p.positionId}>
                {`${p.title} · ${unitName.get(p.unitId) ?? ''}`}
              </option>
            ))}
          </Select>
        )}
        <Select
          label={m.rights_scope()}
          value={draft.scopeUnitId}
          onChange={(e) => setDraft({ ...draft, scopeUnitId: e.target.value })}
        >
          <option value="">{m.agent_scope_all()}</option>
          {screen.chart.units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {m.rights_scope_unit({ unit: u.name })}
            </option>
          ))}
        </Select>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-semibold">{m.agent_watches()}</legend>
          {screen.watches.map((w) => (
            <label key={w} className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={draft.watches.includes(w)}
                onChange={(e) =>
                  setDraft({ ...draft, watches: toggle(draft.watches, w, e.target.checked) })
                }
              />
              {watchLabel(w)}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-body-sm font-semibold">{m.rights_permissions()}</legend>
          {screen.permissions.map((p) => (
            <label key={p} className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={draft.permissions.includes(p)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: toggle(draft.permissions, p, e.target.checked),
                  })
                }
              />
              {permissionLabel(p)}
            </label>
          ))}
        </fieldset>
        <TextField
          label={m.agent_wake_every()}
          type="number"
          min={5}
          value={draft.wakeEveryMinutes}
          onChange={(e) => setDraft({ ...draft, wakeEveryMinutes: e.target.value })}
        />
      </GestureForm>
    </div>
  );
}
