import { Button, FormPage, FormSection, TextField } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  criticalities,
  dataCategories,
  submitAppRequest,
  type Criticality,
  type DataCategory,
} from '@/lib/app-requests';
import { criticalityWords, dataWords } from '@/lib/app-requests-view';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/ressources/demandes/nouvelle')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  component: NewAppRequestPage,
});

/** The identifier a name suggests: lowercase, digits and dashes. */
function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 31);
}

/**
 * Asking for an app (spec 021), on its own page: the need, then the data and the stakes — what IT
 * decides on, and what the factory and its coding agent build from.
 */
function NewAppRequestPage() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const [key] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState({
    name: '',
    slug: '',
    purpose: '',
    users: '',
    ownerContact: me.email,
    dataCategories: [] as DataCategory[],
    criticality: 'medium' as Criticality,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready =
    draft.name.trim().length > 0 &&
    /^[a-z][a-z0-9-]{2,30}$/.test(draft.slug) &&
    draft.purpose.trim().length >= 20 &&
    draft.users.trim().length > 0 &&
    draft.ownerContact.includes('@') &&
    draft.dataCategories.length > 0;

  const toggle = (category: DataCategory, on: boolean) => {
    const others = draft.dataCategories.filter((c) => c !== category && c !== 'none');
    const next: DataCategory[] =
      category === 'none' ? (on ? ['none'] : []) : on ? [...others, category] : others;
    setDraft({ ...draft, dataCategories: next });
  };

  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    void submitAppRequest({ data: { key, ...draft } })
      .then(async (answer) => {
        if (!answer.ok || !answer.requestId) return setError(refusal(answer.error));
        await navigate({
          to: '/ressources/demandes/$requestId',
          params: { requestId: answer.requestId },
        });
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };

  return (
    <AppShell me={me} current="resources">
      <FormPage
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[
          { label: m.nav_resources(), href: '/ressources' },
          { label: m.apr_title(), href: '/ressources/demandes' },
        ]}
        title={m.apr_new_title()}
        description={m.apr_new_explain()}
        onSubmit={submit}
        actions={
          <>
            <Button type="submit" disabled={!ready || busy}>
              {m.apr_send()}
            </Button>
            <a
              href="/ressources/demandes"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg hover:bg-surface-hover"
            >
              {m.common_cancel()}
            </a>
            {error && (
              <p role="alert" className="basis-full text-body-sm text-state-error-fg">
                {error}
              </p>
            )}
          </>
        }
      >
        <FormSection title={m.apr_section_need()} description={m.apr_section_need_body()}>
          <TextField
            label={m.apr_name()}
            value={draft.name}
            maxLength={80}
            required
            onChange={(e) =>
              setDraft({
                ...draft,
                name: e.target.value,
                ...(slugTouched ? {} : { slug: slugOf(e.target.value) }),
              })
            }
          />
          <TextField
            label={m.apr_slug()}
            hint={m.apr_slug_hint()}
            value={draft.slug}
            maxLength={31}
            required
            onChange={(e) => {
              setSlugTouched(true);
              setDraft({ ...draft, slug: e.target.value.toLowerCase() });
            }}
          />
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
            {m.apr_purpose()}
            <textarea
              className="min-h-40 rounded-control border border-line-control bg-surface-control p-3 font-normal text-fg"
              value={draft.purpose}
              maxLength={4000}
              required
              aria-describedby="purpose-hint"
              onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
            />
            <span id="purpose-hint" className="font-normal text-fg-muted">
              {m.apr_purpose_hint()}
            </span>
          </label>
          <TextField
            label={m.apr_users()}
            value={draft.users}
            maxLength={1000}
            required
            onChange={(e) => setDraft({ ...draft, users: e.target.value })}
          />
          <TextField
            label={m.apr_owner()}
            type="email"
            value={draft.ownerContact}
            required
            onChange={(e) => setDraft({ ...draft, ownerContact: e.target.value })}
          />
        </FormSection>
        <FormSection title={m.apr_section_data()} description={m.apr_section_data_body()}>
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-body-sm font-semibold">{m.apr_data()}</legend>
            {dataCategories.map((category) => (
              <label key={category} className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={draft.dataCategories.includes(category)}
                  onChange={(e) => toggle(category, e.target.checked)}
                />
                {dataWords[category]()}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-body-sm font-semibold">{m.apr_criticality()}</legend>
            {criticalities.map((level) => (
              <label key={level} className="flex items-center gap-2 text-body-sm">
                <input
                  type="radio"
                  name="criticality"
                  checked={draft.criticality === level}
                  onChange={() => setDraft({ ...draft, criticality: level })}
                />
                {criticalityWords[level]()}
              </label>
            ))}
          </fieldset>
        </FormSection>
      </FormPage>
    </AppShell>
  );
}
