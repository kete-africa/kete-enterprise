import { Button, PageHeader, PageSection, Tag, TextField, type TagTone } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import {
  fetchToolSets,
  importToolSet,
  setToolSetStatus,
  type ToolEffect,
  type ToolSet,
} from '@/lib/tools';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/outils')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchToolSets(),
  component: ToolsPage,
});

const effectWords: Record<ToolEffect, () => string> = {
  read: m.tools_effect_read,
  act: m.tools_effect_act,
  destroy: m.tools_effect_destroy,
};
const effectTone: Record<ToolEffect, TagTone> = {
  read: 'validated',
  act: 'verify',
  destroy: 'error',
};

/** One imported set: its tools with how far an agent goes with each, and its gesture. */
function SetRow({ set }: { set: ToolSet }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const move = async (status: 'active' | 'off') => {
    setPending(true);
    setError(null);
    const answer = await setToolSetStatus({ data: { setId: set.setId, status } });
    setPending(false);
    if (!answer.ok) setError(refusal(answer.error));
    await router.invalidate();
  };
  return (
    <li className="grid gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={set.status === 'active' ? 'validated' : 'neutral'}>
          {set.status === 'active' ? m.tools_status_active() : m.tools_status_off()}
        </Tag>
        <span className="font-semibold">{set.label}</span>
        <span className="text-body-sm text-fg-muted">
          {set.kind === 'mcp' ? m.tools_kind_mcp() : m.tools_kind_openapi()} · {set.address}
        </span>
      </div>
      <ul className="grid gap-1 text-body-sm">
        {set.tools.map((tool) => (
          <li key={tool.name} className="flex flex-wrap items-baseline gap-2">
            <Tag tone={effectTone[tool.effect]}>{effectWords[tool.effect]()}</Tag>
            <code className="font-mono break-all">{tool.name}</code>
            {tool.description && <span className="text-fg-muted">{tool.description}</span>}
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => void move(set.status === 'active' ? 'off' : 'active')}
        >
          {set.status === 'active' ? m.tools_turn_off() : m.tools_turn_on()}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

const empty = {
  kind: 'openapi' as 'openapi' | 'mcp',
  label: '',
  prefix: '',
  address: '',
  baseUrl: '',
  secret: '',
};

/**
 * Tools (spec 093): the organization's own tools, imported for its agents. A read runs alone, an
 * act is a draft someone decides, a destruction needs a confirmation — under the same policies
 * and journal as Kete's own.
 */
function ToolsPage() {
  const { me } = Route.useRouteContext();
  const { sets } = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (field: keyof typeof empty) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [field]: event.target.value });
  const ready =
    draft.label.trim() &&
    /^[a-z][a-z0-9]{1,15}$/.test(draft.prefix.trim()) &&
    draft.address.trim().startsWith('https://');

  return (
    <AppShell me={me} current="tools">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_tools()}
        description={m.tools_explain()}
      />
      <PageSection first title={m.tools_list()}>
        {sets.length === 0 ? (
          <p className="text-fg-muted">{m.tools_none()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {sets.map((one) => (
              <SetRow key={one.setId} set={one} />
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.tools_import()}>
        <form
          className="grid gap-3 md:max-w-2xl"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const answer = await importToolSet({ data: draft }).catch(() => ({
              ok: false as const,
              error: 'invalid_input' as string,
            }));
            setPending(false);
            if (!answer.ok) return setError(refusal(answer.error));
            setDraft(empty);
            await router.invalidate();
          }}
        >
          <label className="grid gap-1.5 text-body-sm font-semibold">
            {m.tools_kind()}
            <select
              className="rounded-control border border-line-control bg-surface-control p-2 font-normal"
              value={draft.kind}
              onChange={set('kind')}
            >
              <option value="openapi">{m.tools_kind_openapi()}</option>
              <option value="mcp">{m.tools_kind_mcp()}</option>
            </select>
          </label>
          <TextField label={m.field_name()} value={draft.label} onChange={set('label')} required />
          <TextField
            label={m.tools_prefix()}
            hint={m.tools_prefix_hint()}
            value={draft.prefix}
            onChange={set('prefix')}
            required
          />
          <TextField
            label={draft.kind === 'mcp' ? m.tools_address_mcp() : m.tools_address_openapi()}
            hint={m.tools_address_hint()}
            value={draft.address}
            onChange={set('address')}
            required
          />
          {draft.kind === 'openapi' && (
            <TextField
              label={m.tools_base_url()}
              hint={m.tools_base_url_hint()}
              value={draft.baseUrl}
              onChange={set('baseUrl')}
            />
          )}
          <TextField
            type="password"
            autoComplete="off"
            label={m.connector_secret()}
            hint={m.connector_secret_hint()}
            value={draft.secret}
            onChange={set('secret')}
          />
          {error && (
            <p role="alert" className="text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending || !ready}>
              {m.tools_import_button()}
            </Button>
          </div>
          <p className="text-body-sm text-fg-muted">{m.tools_safeguards()}</p>
        </form>
      </PageSection>
    </AppShell>
  );
}
