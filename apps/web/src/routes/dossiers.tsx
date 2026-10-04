import { EmptyState, PageHeader, Row, RowList, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { createDossier, fetchDossiers } from '@/lib/dossiers';
import { DialogForm, refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/dossiers')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchDossiers(),
  component: DossiersPage,
});

/** Her dossiers (spec 034): one space per subject, shared with its members. */
function DossiersPage() {
  const { me } = Route.useRouteContext();
  const { dossiers } = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AppShell me={me} current="dossiers">
      <PageHeader
        title={m.dossiers_title()}
        description={m.dossiers_explain()}
        actions={
          <DialogForm
            title={m.dossiers_new()}
            trigger="primary"
            busy={busy}
            ready={draft.name.trim() !== ''}
            onSubmit={() => {
              setBusy(true);
              void createDossier({ data: draft })
                .then(async (answer) => {
                  if (!answer.ok) setError(refusal(answer.error));
                  else setDraft({ name: '', description: '' });
                  await router.invalidate();
                })
                .finally(() => setBusy(false));
            }}
          >
            <TextField
              label={m.dossiers_name()}
              value={draft.name}
              maxLength={160}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <TextField
              label={m.dossiers_description()}
              value={draft.description}
              maxLength={1000}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </DialogForm>
        }
      />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      {dossiers.length === 0 ? (
        <EmptyState title={m.dossiers_none()} />
      ) : (
        <RowList label={m.dossiers_title()}>
          {dossiers.map((d) => (
            <Row
              key={d.dossierId}
              href={`/dossiers/${d.dossierId}`}
              title={d.name}
              meta={[
                d.description,
                m.dossiers_members_count({ count: d.members }),
                d.archived ? m.dossiers_archived() : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </RowList>
      )}
    </AppShell>
  );
}
