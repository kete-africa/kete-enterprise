import { Button, Panel, Tag, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { GestureForm, optional, refusal, Select } from './forms';
import {
  changeRegistry,
  resourceKinds,
  type RegistryScreen,
  type Resource,
  type ResourceKind,
  type Risk,
  type Tier,
} from './registry';

export function kindLabel(kind: ResourceKind): string {
  return { app: m.kind_app, skill: m.kind_skill, mcp: m.kind_mcp, agent: m.kind_agent }[kind]();
}

function RiskTag({ risk }: { risk: Risk }) {
  const label = {
    unknown: m.risk_unknown,
    low: m.risk_low,
    medium: m.risk_medium,
    high: m.risk_high,
  }[risk]();
  const tone =
    risk === 'high'
      ? 'error'
      : risk === 'unknown'
        ? 'verify'
        : risk === 'medium'
          ? 'info'
          : 'validated';
  return <Tag tone={tone}>{label}</Tag>;
}

function tierLabel(tier: Tier, unitName: Map<string, string>): string {
  if (tier.kind === 'personal') return m.tier_personal();
  if (tier.kind === 'organization') return m.tier_organization();
  return m.tier_unit({ unit: unitName.get(tier.unitId) ?? '…' });
}

/** Sends one registry gesture, then reloads; a refusal is shown in the person's words. */
function useGesture() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const send = (path: string, body: object = {}) => {
    setError(null);
    void changeRegistry({ data: { path, body, key: crypto.randomUUID() } }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      await router.invalidate();
    });
  };
  return { error, send };
}

function ResourceRow({
  resource,
  screen,
  unitName,
}: {
  resource: Resource;
  screen: RegistryScreen;
  unitName: Map<string, string>;
}) {
  const { error, send } = useGesture();
  const [target, setTarget] = useState('');
  const owner = resource.ownerUserId === screen.me;
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{resource.name}</span>
        <Tag>{kindLabel(resource.kind)}</Tag>
        <RiskTag risk={resource.risk} />
        {resource.flags.includes('no_card') && <Tag tone="verify">{m.flag_no_card()}</Tag>}
        {resource.flags.includes('no_owner') && <Tag tone="verify">{m.flag_no_owner()}</Tag>}
        {resource.status === 'retired' && <Tag>{m.status_retired()}</Tag>}
      </div>
      <p className="text-body-sm text-fg-muted">
        {`${tierLabel(resource.tier, unitName)} · ${resource.ownerName}`}
      </p>
      {resource.status === 'active' && (
        <div className="flex flex-wrap items-end gap-2">
          {owner && (
            <>
              <Select
                label={m.promote_to()}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{m.field_choose()}</option>
                {screen.units.map((u) => (
                  <option key={u.unitId} value={u.unitId}>
                    {u.name}
                  </option>
                ))}
                <option value="organization">{m.tier_organization()}</option>
              </Select>
              <Button
                variant="secondary"
                disabled={target === ''}
                onClick={() =>
                  send(`/resources/${resource.resourceId}/promotions`, {
                    target:
                      target === 'organization'
                        ? { kind: 'organization' }
                        : { kind: 'unit', unitId: target },
                  })
                }
              >
                {m.promote()}
              </Button>
            </>
          )}
          {resource.address && (
            <Button
              variant="secondary"
              onClick={() => send(`/resources/${resource.resourceId}/refresh`)}
            >
              {m.refresh_card()}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => send(`/resources/${resource.resourceId}/retire`)}
          >
            {m.retire()}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

/** The promotions this person may decide: never her own requests. */
function ToDecide({ screen, unitName }: { screen: RegistryScreen; unitName: Map<string, string> }) {
  const { error, send } = useGesture();
  if (screen.toDecide.length === 0) return <p className="text-fg-muted">{m.nothing_to_decide()}</p>;
  return (
    <ul className="grid gap-3">
      {screen.toDecide.map((p) => (
        <li key={p.promotionId} className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">{p.resource?.name ?? '…'}</span>
          {p.resource && <RiskTag risk={p.resource.risk} />}
          <span className="text-body-sm text-fg-muted">
            {`${p.resource?.ownerName ?? ''} → ${tierLabel(p.target, unitName)}`}
          </span>
          <Button
            onClick={() => send(`/promotions/${p.promotionId}/decide`, { decision: 'approve' })}
          >
            {m.approve()}
          </Button>
          <Button
            variant="secondary"
            onClick={() => send(`/promotions/${p.promotionId}/decide`, { decision: 'refuse' })}
          >
            {m.refuse()}
          </Button>
        </li>
      ))}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </ul>
  );
}

export function RegistryView({ screen }: { screen: RegistryScreen }) {
  const unitName = new Map(screen.units.map((u) => [u.unitId, u.name]));
  const [draft, setDraft] = useState({
    kind: 'app' as ResourceKind,
    name: '',
    description: '',
    address: '',
  });
  const mine = screen.resources.filter((r) => r.ownerUserId === screen.me);
  const others = screen.resources.filter((r) => r.ownerUserId !== screen.me);
  return (
    <div className="grid gap-6">
      {screen.reviews && (
        <Panel title={m.registry_to_decide()}>
          <ToDecide screen={screen} unitName={unitName} />
        </Panel>
      )}
      <Panel title={m.registry_mine()}>
        {mine.length === 0 ? (
          <p className="text-fg-muted">{m.registry_mine_empty()}</p>
        ) : (
          <ul>
            {mine.map((r) => (
              <ResourceRow key={r.resourceId} resource={r} screen={screen} unitName={unitName} />
            ))}
          </ul>
        )}
        {screen.mine.length > 0 && (
          <p className="mt-3 text-body-sm text-fg-muted">
            {m.registry_waiting({ count: screen.mine.length })}
          </p>
        )}
      </Panel>
      <Panel title={m.registry_shared()}>
        {others.length === 0 ? (
          <p className="text-fg-muted">{m.registry_shared_empty()}</p>
        ) : (
          <ul>
            {others.map((r) => (
              <ResourceRow key={r.resourceId} resource={r} screen={screen} unitName={unitName} />
            ))}
          </ul>
        )}
      </Panel>
      <GestureForm
        title={m.registry_register()}
        ready={draft.name.trim() !== ''}
        send={(key) =>
          changeRegistry({
            data: {
              path: '/resources',
              body: {
                kind: draft.kind,
                name: draft.name,
                description: optional(draft.description),
                address: optional(draft.address),
              },
              key,
            },
          })
        }
        onDone={() => setDraft({ ...draft, name: '', description: '', address: '' })}
      >
        <Select
          label={m.field_kind()}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as ResourceKind })}
        >
          {resourceKinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_name()}
          value={draft.name}
          required
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <TextField
          label={m.field_description()}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        {(draft.kind === 'app' || draft.kind === 'mcp') && (
          <TextField
            label={m.field_address()}
            hint={m.field_address_hint()}
            type="url"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
        )}
      </GestureForm>
    </div>
  );
}
