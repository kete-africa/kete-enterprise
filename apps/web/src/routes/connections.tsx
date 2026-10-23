import { Button, EmptyState, PageHeader, PageSection, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { callApi, sendGesture } from '@/platform/api';
import * as m from '@/paraglide/messages.js';

// One connection, three uses (spec 105; doctrine D-062, R8, R17): each tool of the organization
// seen once — what it reads, what its agents may do with it, tool by tool, what it signals — and
// whether it answers. A webhook's secret is shown once, here.

interface Connection {
  connectionId: string;
  label: string;
  address: string;
  adapter: 'mcp' | 'openapi';
  uses: {
    read: boolean;
    act: { tool: string; description: string; level: number | null }[];
    signal: string[];
  };
  health: 'ok' | 'reconnect' | 'off' | 'trial';
  lastError: string | null;
  webhook: boolean;
}

const fetchConnections = createServerFn({ method: 'GET' }).handler(() =>
  callApi<{ connections: Connection[] }>(getRequest(), '/v1/connections')
    .then((answer) => answer.connections)
    .catch(() => null),
);

const idOf = (value: unknown) => {
  if (typeof value !== 'string' || !/^(tls|cnr)_[0-9a-f-]{8,64}$/.test(value)) {
    throw new Error('Unknown.');
  }
  return value;
};

const putGrants = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { connectionId?: unknown; read?: unknown; act?: unknown };
    const act = Object.fromEntries(
      Object.entries((v.act ?? {}) as Record<string, unknown>).filter(
        ([tool, level]) =>
          /^[a-z][a-z0-9_]{0,119}$/.test(tool) && [1, 2, 3].includes(Number(level)),
      ),
    );
    return { connectionId: idOf(v.connectionId), read: v.read !== false, act };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/connections/${data.connectionId}/grants`,
      { read: data.read, act: data.act },
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });

const openHook = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    connectionId: idOf((input as { connectionId?: unknown })?.connectionId),
  }))
  .handler(async ({ data }) => {
    const answer = await sendGesture<{ secret: string }>(
      getRequest(),
      `/v1/connections/${data.connectionId}/webhook`,
      {},
      crypto.randomUUID(),
    );
    return answer.ok
      ? { ok: true as const, secret: answer.data.secret, error: null }
      : { ok: false as const, secret: null, error: answer.error };
  });

export const Route = createFileRoute('/administration/connexions')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchConnections(),
  component: ConnectionsPage,
});

const healthWords = {
  ok: () => m.connections_health_ok(),
  reconnect: () => m.connections_health_reconnect(),
  off: () => m.connections_health_off(),
  trial: () => m.connections_health_trial(),
};
const healthTone = {
  ok: 'validated',
  reconnect: 'error',
  off: 'neutral',
  trial: 'verify',
} as const;

function ConnectionsPage() {
  const { me } = Route.useRouteContext();
  const connections = Route.useLoaderData();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  return (
    <AppShell me={me} current="admin">
      <PageHeader title={m.connections_title()} description={m.connections_explain()} />
      {!connections ? (
        <EmptyState title={m.connections_forbidden()} />
      ) : connections.length === 0 ? (
        <EmptyState title={m.connections_none()} />
      ) : (
        connections.map((c) => (
          <PageSection key={c.connectionId} title={c.label}>
            <div className="grid gap-3 text-body-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={healthTone[c.health]}>{healthWords[c.health]()}</Tag>
                <span className="text-fg-muted [overflow-wrap:anywhere]">{c.address}</span>
              </div>
              {c.lastError && <p className="m-0 text-state-error-fg">{c.lastError}</p>}
              <dl className="m-0 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
                <dt className="font-semibold">{m.connections_read()}</dt>
                <dd className="m-0">{c.uses.read ? m.connections_yes() : m.connections_no()}</dd>
                <dt className="font-semibold">{m.connections_act()}</dt>
                <dd className="m-0">
                  {c.uses.act.length === 0 ? (
                    m.connections_nothing()
                  ) : (
                    <ul className="m-0 grid list-none gap-1.5 p-0">
                      {c.uses.act.map((tool) => (
                        <li key={tool.tool} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12px]">{tool.tool}</span>
                          <span className="text-fg-muted">{tool.description}</span>
                          {c.connectionId.startsWith('tls_') && (
                            <button
                              type="button"
                              aria-pressed={tool.level !== null}
                              className="h-[26px] rounded-full border border-line-control px-2.5 text-[12px] font-semibold aria-pressed:bg-surface-selected"
                              onClick={async () => {
                                setNote(null);
                                const act = Object.fromEntries(
                                  c.uses.act
                                    .filter((t) =>
                                      t.tool === tool.tool ? tool.level === null : t.level !== null,
                                    )
                                    .map((t) => [t.tool, 3]),
                                );
                                const answer = await putGrants({
                                  data: { connectionId: c.connectionId, read: c.uses.read, act },
                                });
                                if (!answer.ok) return setNote(refusal(answer.error));
                                await router.invalidate();
                              }}
                            >
                              {tool.level === null
                                ? m.connections_grant()
                                : m.connections_granted()}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
                <dt className="font-semibold">{m.connections_signal()}</dt>
                <dd className="m-0">
                  {c.uses.signal.length ? c.uses.signal.join(', ') : m.connections_nothing()}
                </dd>
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    setNote(null);
                    const answer = await openHook({ data: { connectionId: c.connectionId } });
                    if (!answer.ok || !answer.secret) return setNote(refusal(answer.error));
                    setSecret({ id: c.connectionId, value: answer.secret });
                    await router.invalidate();
                  }}
                >
                  {c.webhook ? m.connections_webhook_renew() : m.connections_webhook_open()}
                </Button>
                {secret?.id === c.connectionId && (
                  <p className="m-0 grid gap-1">
                    <span className="text-fg-muted">{m.connections_webhook_once()}</span>
                    <code className="[overflow-wrap:anywhere]">{secret.value}</code>
                    <span className="text-fg-muted">
                      {m.connections_webhook_where({
                        path: `/public/connections/${c.connectionId}/webhook`,
                      })}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </PageSection>
        ))
      )}
      {note && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {note}
        </p>
      )}
    </AppShell>
  );
}
