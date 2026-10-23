import { Button, EmptyState, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { createAsset, fetchObjects, type IndexedObject } from '@/lib/objects';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

type Search = { unite?: string; etat?: string };

export const Route = createFileRoute('/equipements')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search['unite'] === 'string' ? { unite: search['unite'].slice(0, 80) } : {}),
    ...(typeof search['etat'] === 'string' ? { etat: search['etat'].slice(0, 40) } : {}),
  }),
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    // One reading of the index: her assets, and the titles of what they belong to.
    const [found, units] = await Promise.all([
      fetchObjects({
        data: { kind: 'asset', unit: deps.unite ?? '', state: deps.etat ?? '', closed: true },
      }),
      fetchObjects({ data: { kind: 'unit' } }),
    ]);
    return { assets: found.objects, titles: found.titles, units: units.objects };
  },
  component: AssetsPage,
});

export const toneOf = (o: Pick<IndexedObject, 'stateTone'>) =>
  o.stateTone === 'ok'
    ? 'validated'
    : o.stateTone === 'verify'
      ? 'verify'
      : o.stateTone === 'error'
        ? 'error'
        : o.stateTone === 'info'
          ? 'info'
          : 'neutral';

/**
 * Assets (spec 100; doctrine D-056, D-062): what the organization installs or owns and keeps for
 * years — one collection of the index, grouped by the unit that keeps them, each opening its page.
 */
function AssetsPage() {
  const { me } = Route.useRouteContext();
  const { assets, titles, units } = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const manages = me.administrator || me.permissions.includes('objects:manage');
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const groups = new Map<string, IndexedObject[]>();
  for (const asset of assets) {
    const key = asset.unitId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), asset]);
  }

  return (
    <AppShell me={me} current="assets">
      <PageHeader title={m.nav_assets()} description={m.assets_explain()} />
      {manages && (
        <PageSection first title={m.assets_new()}>
          <form
            className="flex flex-wrap items-end gap-2 md:max-w-3xl"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              const answer = await createAsset({
                data: { name, subtype, unitId: search.unite ?? '' },
              });
              setPending(false);
              if (!answer.ok) return setError(refusal(answer.error));
              await router.navigate({ to: `/equipements/${answer.assetId}` });
            }}
          >
            <div className="min-w-0 flex-1 basis-64">
              <TextField
                label={m.assets_name()}
                hint={m.assets_name_hint()}
                value={name}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="min-w-0 basis-48">
              <TextField
                label={m.assets_subtype()}
                hint={m.assets_subtype_hint()}
                value={subtype}
                maxLength={60}
                onChange={(event) => setSubtype(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={pending || !name.trim()}>
              {m.assets_create()}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </PageSection>
      )}
      <PageSection first={!manages} title={m.assets_list()}>
        {units.length > 0 && (
          <nav aria-label={m.assets_by_unit()} className="mb-3 flex flex-wrap gap-2">
            <a
              href="/equipements"
              aria-current={!search.unite ? 'page' : undefined}
              className="rounded-full border border-line-control px-3 py-1 text-body-sm font-semibold aria-[current=page]:bg-accent-soft"
            >
              {m.assets_all_units()}
            </a>
            {units.map((unit) => (
              <a
                key={unit.id}
                href={`/equipements?unite=${unit.id}`}
                aria-current={search.unite === unit.id ? 'page' : undefined}
                className="rounded-full border border-line-control px-3 py-1 text-body-sm font-semibold aria-[current=page]:bg-accent-soft"
              >
                {unit.title}
              </a>
            ))}
          </nav>
        )}
        {assets.length === 0 ? (
          <EmptyState title={m.assets_none()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-line text-start text-fg-muted">
                  <th className="py-2 pe-3 text-start font-normal">{m.assets_col_asset()}</th>
                  <th className="py-2 pe-3 text-start font-normal">{m.assets_col_party()}</th>
                  <th className="py-2 pe-3 text-start font-normal">{m.assets_col_project()}</th>
                  <th className="py-2 text-start font-normal">{m.assets_col_state()}</th>
                </tr>
              </thead>
              {[...groups.entries()].map(([unitId, rows]) => (
                <tbody key={unitId || 'none'} className="divide-y divide-line">
                  <tr className="bg-bg">
                    <th
                      colSpan={4}
                      className="py-1.5 text-start text-caption font-semibold uppercase tracking-wide text-fg-muted"
                    >
                      {(unitId && titles[`unit:${unitId}`]) || m.assets_no_unit()} · {rows.length}
                    </th>
                  </tr>
                  {rows.map((asset) => (
                    <tr key={asset.id}>
                      <td className="py-2 pe-3">
                        <a
                          href={`/equipements/${asset.id}`}
                          className="font-semibold text-link underline"
                        >
                          {asset.title}
                        </a>
                      </td>
                      <td className="py-2 pe-3">
                        {(asset.partyId && titles[`party:${asset.partyId}`]) || '—'}
                      </td>
                      <td className="py-2 pe-3">
                        {(asset.projectId && titles[`project:${asset.projectId}`]) || '—'}
                      </td>
                      <td className="py-2">
                        <Tag tone={toneOf(asset)}>{asset.stateLabel ?? asset.state}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </PageSection>
    </AppShell>
  );
}
