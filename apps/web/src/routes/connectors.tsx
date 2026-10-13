import { Button, PageHeader, PageSection, Tag, TextField, type TagTone } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import {
  createConnector,
  fetchConnectors,
  setConnectorStatus,
  tryConnector,
  type Connector,
  type Preset,
  type ReadReport,
} from '@/lib/connectors';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/administration/connecteurs')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchConnectors(),
  component: ConnectorsPage,
});

const statusWords: Record<Connector['status'], () => string> = {
  trial: m.connector_status_trial,
  connected: m.connector_status_connected,
  off: m.connector_status_off,
};
const statusTone: Record<Connector['status'], TagTone> = {
  trial: 'verify',
  connected: 'validated',
  off: 'neutral',
};
const when = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** One connector: what it reads, its state, its trial — and its gestures. */
function ConnectorRow({ connector }: { connector: Connector }) {
  const router = useRouter();
  const [report, setReport] = useState<ReadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run<T>(work: Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
    setPending(true);
    setError(null);
    const answer = await work;
    setPending(false);
    if (!answer.ok) setError(refusal(answer.error));
    await router.invalidate();
    return answer.ok ? answer.data : null;
  }
  const read = async (file: boolean) => {
    const answer = await run(tryConnector({ data: { connectorId: connector.connectorId, file } }));
    if (answer) setReport(answer.report);
  };
  const move = (status: 'connected' | 'off') =>
    void run(setConnectorStatus({ data: { connectorId: connector.connectorId, status } }));

  return (
    <li className="grid gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={statusTone[connector.status]}>{statusWords[connector.status]()}</Tag>
        <span className="font-semibold">{connector.name}</span>
        <span className="text-body-sm text-fg-muted">{connector.address}</span>
      </div>
      <p className="text-body-sm text-fg-muted">
        {m.connector_reads({ label: connector.reading.label, tool: connector.reading.tool })}{' '}
        {m.connector_never_writes()}
        {connector.lastReadAt
          ? ` · ${m.connector_last_read({ at: when(connector.lastReadAt) })}`
          : ''}
      </p>
      {connector.lastError && (
        <p className="text-body-sm text-state-error-fg">
          {m.connector_last_error({ reason: refusal(connector.lastError) })}
        </p>
      )}
      {report && (
        <div
          role="status"
          className="grid gap-1 rounded-box border border-line bg-surface-muted p-3"
        >
          <p>
            {m.connector_report({
              found: String(report.found),
              filed: String(report.filed.length),
              unmatched: String(report.unmatched.length),
              closed: String(report.closed),
            })}
          </p>
          <ul className="grid gap-1 text-body-sm">
            {report.filed.slice(0, 8).map((item) => (
              <li key={item.key}>
                {item.key} · {item.title} → <span className="font-semibold">{item.person}</span>
              </li>
            ))}
            {report.unmatched.slice(0, 5).map((item) => (
              <li key={item.key} className="text-fg-muted">
                {m.connector_unmatched({ key: item.key, email: item.email })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {connector.status !== 'connected' && (
          <Button variant="secondary" disabled={pending} onClick={() => void read(false)}>
            {m.connector_try()}
          </Button>
        )}
        {connector.status === 'connected' ? (
          <>
            <Button variant="secondary" disabled={pending} onClick={() => void read(true)}>
              {m.connector_read_now()}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => move('off')}>
              {m.connector_switch_off()}
            </Button>
          </>
        ) : (
          <Button disabled={pending || !connector.triedAt} onClick={() => move('connected')}>
            {m.connector_connect()}
          </Button>
        )}
      </div>
      {connector.status !== 'connected' && !connector.triedAt && (
        <p className="text-body-sm text-fg-muted">{m.connector_try_first()}</p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

const empty = {
  name: '',
  address: '',
  secret: '',
  tool: '',
  arguments: '{}',
  label: '',
  fieldKey: '',
  fieldTitle: '',
  fieldPerson: '',
  link: '',
};
const fromPreset = (preset: Preset) => ({
  ...empty,
  name: preset.name,
  tool: preset.reading.tool,
  arguments: preset.reading.arguments,
  label: preset.reading.label,
  fieldKey: preset.reading.fields.key,
  fieldTitle: preset.reading.fields.title,
  fieldPerson: preset.reading.fields.person,
  link: preset.reading.link,
});

/**
 * Connectors (spec 069): a tool the organization already has, read through its MCP server. What
 * waits there for a person lands in her « Décider ». It reads, and nothing else.
 */
function ConnectorsPage() {
  const { me } = Route.useRouteContext();
  const { connectors, presets } = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (field: keyof typeof empty) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [field]: event.target.value });
  const ready =
    draft.name.trim() &&
    draft.address.trim().startsWith('https://') &&
    draft.tool.trim() &&
    draft.label.trim() &&
    draft.fieldKey.trim() &&
    draft.fieldTitle.trim() &&
    draft.fieldPerson.trim() &&
    draft.link.trim().startsWith('https://');

  return (
    <AppShell me={me} current="connectors">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_connectors()}
        description={m.connectors_explain()}
      />
      <PageSection first title={m.connectors_list()}>
        {connectors.length === 0 ? (
          <p className="text-fg-muted">{m.connectors_none()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {connectors.map((connector) => (
              <ConnectorRow key={connector.connectorId} connector={connector} />
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.connectors_add()}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-body-sm text-fg-muted">{m.connectors_start_from()}</span>
          {presets.map((preset) => (
            <Button
              key={preset.key}
              variant="secondary"
              onClick={() => setDraft(fromPreset(preset))}
            >
              {preset.name}
            </Button>
          ))}
        </div>
        <form
          className="grid gap-3 md:max-w-2xl"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const answer = await createConnector({ data: draft }).catch(() => ({
              ok: false as const,
              error: 'invalid_input' as string,
            }));
            setPending(false);
            if (!answer.ok) return setError(refusal(answer.error));
            setDraft(empty);
            await router.invalidate();
          }}
        >
          <TextField label={m.field_name()} value={draft.name} onChange={set('name')} required />
          <TextField
            label={m.connector_address()}
            hint={m.connector_address_hint()}
            value={draft.address}
            onChange={set('address')}
            required
          />
          <TextField
            type="password"
            autoComplete="off"
            label={m.connector_secret()}
            hint={m.connector_secret_hint()}
            value={draft.secret}
            onChange={set('secret')}
          />
          <TextField
            label={m.connector_tool()}
            hint={m.connector_tool_hint()}
            value={draft.tool}
            onChange={set('tool')}
            required
          />
          <label className="grid gap-1.5 text-body-sm font-semibold">
            {m.connector_arguments()}
            <textarea
              className="min-h-28 rounded-control border border-line-control bg-surface-control p-3 font-mono font-normal"
              value={draft.arguments}
              maxLength={4000}
              onChange={set('arguments')}
            />
          </label>
          <TextField
            label={m.connector_label()}
            hint={m.connector_label_hint()}
            value={draft.label}
            onChange={set('label')}
            required
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label={m.connector_field_key()}
              value={draft.fieldKey}
              onChange={set('fieldKey')}
              required
            />
            <TextField
              label={m.connector_field_title()}
              value={draft.fieldTitle}
              onChange={set('fieldTitle')}
              required
            />
            <TextField
              label={m.connector_field_person()}
              value={draft.fieldPerson}
              onChange={set('fieldPerson')}
              required
            />
          </div>
          <TextField
            label={m.connector_link()}
            hint={m.connector_link_hint({ key: '{key}' })}
            value={draft.link}
            onChange={set('link')}
            required
          />
          {error && (
            <p role="alert" className="text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending || !ready}>
              {m.connectors_create()}
            </Button>
          </div>
          <p className="text-body-sm text-fg-muted">{m.connectors_safeguards()}</p>
        </form>
      </PageSection>
    </AppShell>
  );
}
