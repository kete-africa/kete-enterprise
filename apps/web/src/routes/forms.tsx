import { Button, EmptyState, PageHeader, PageSection, Row, RowList, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { createCollection, fetchCollections, type FieldType } from '@/lib/collections';
import { DialogForm, refusal, Select } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/formulaires')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchCollections(),
  component: FormsPage,
});

type Draft = { label: string; type: FieldType; required: boolean; options: string };
const emptyField = (): Draft => ({ label: '', type: 'text', required: false, options: '' });
/** A field's key from its label: lowercase letters, digits and underscores. */
const keyOf = (label: string, index: number) =>
  label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 36) || `champ_${index + 1}`;

/** Her forms (spec 032): those she runs, those she may fill in, and a new one. */
function FormsPage() {
  const { me } = Route.useRouteContext();
  const { mine, toAnswer } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [answeredBy, setAnsweredBy] = useState<'everyone' | 'link'>('everyone');
  const [measure, setMeasure] = useState('');
  const [fields, setFields] = useState<Draft[]>([emptyField()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeLabels: Record<FieldType, () => string> = {
    text: m.forms_type_text,
    long_text: m.forms_type_long_text,
    number: m.forms_type_number,
    date: m.forms_type_date,
    choice: m.forms_type_choice,
    yes_no: m.forms_type_yes_no,
  };
  const keyed = fields.map((f, i) => ({ ...f, key: keyOf(f.label, i) }));
  const change = (index: number, patch: Partial<Draft>) =>
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  return (
    <AppShell me={me} current="forms">
      <PageHeader
        title={m.forms_title()}
        description={m.forms_explain()}
        actions={
          <DialogForm
            title={m.forms_new()}
            trigger="primary"
            busy={busy}
            ready={name.trim() !== '' && fields.every((f) => f.label.trim())}
            onSubmit={() => {
              setBusy(true);
              setError(null);
              void createCollection({
                data: {
                  name,
                  description,
                  answeredBy,
                  measureField: measure,
                  fields: keyed.map((f) => ({
                    key: f.key,
                    label: f.label,
                    type: f.type,
                    required: f.required,
                    ...(f.type === 'choice'
                      ? {
                          options: f.options
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        }
                      : {}),
                  })),
                },
              })
                .then(async (answer) => {
                  if (!answer.ok) return setError(refusal(answer.error));
                  setName('');
                  setDescription('');
                  setFields([emptyField()]);
                  await router.invalidate();
                })
                .catch(() => setError(m.error_generic()))
                .finally(() => setBusy(false));
            }}
          >
            <TextField
              label={m.forms_name()}
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label={m.forms_description()}
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Select
              label={m.forms_answered_by()}
              value={answeredBy}
              onChange={(e) => setAnsweredBy(e.target.value === 'link' ? 'link' : 'everyone')}
            >
              <option value="everyone">{m.forms_by_everyone()}</option>
              <option value="link">{m.forms_by_link()}</option>
            </Select>
            <h3 className="font-semibold">{m.forms_fields()}</h3>
            {fields.map((f, index) => (
              <div key={index} className="grid gap-2 rounded-box border border-line p-3">
                <TextField
                  label={m.forms_field_label()}
                  value={f.label}
                  maxLength={300}
                  onChange={(e) => change(index, { label: e.target.value })}
                />
                <Select
                  label={m.forms_field_type()}
                  value={f.type}
                  onChange={(e) => change(index, { type: e.target.value as FieldType })}
                >
                  {(Object.keys(typeLabels) as FieldType[]).map((type) => (
                    <option key={type} value={type}>
                      {typeLabels[type]()}
                    </option>
                  ))}
                </Select>
                {f.type === 'choice' && (
                  <TextField
                    label={m.forms_field_options()}
                    value={f.options}
                    onChange={(e) => change(index, { options: e.target.value })}
                  />
                )}
                <div className="flex flex-wrap items-center gap-4 text-body-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => change(index, { required: e.target.checked })}
                    />
                    {m.forms_field_required()}
                  </label>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      className="font-semibold text-link underline"
                      onClick={() => setFields(fields.filter((_, i) => i !== index))}
                    >
                      {m.forms_field_remove()}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div>
              <Button variant="secondary" onClick={() => setFields([...fields, emptyField()])}>
                {m.forms_field_add()}
              </Button>
            </div>
            <Select
              label={m.forms_measure()}
              value={measure}
              onChange={(e) => setMeasure(e.target.value)}
            >
              <option value="">{m.forms_measure_none()}</option>
              {keyed
                .filter((f) => f.type === 'number' && f.label.trim())
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </Select>
          </DialogForm>
        }
      />
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      <PageSection first title={m.forms_to_answer()}>
        {toAnswer.length === 0 ? (
          <EmptyState title={m.forms_none()} />
        ) : (
          <RowList label={m.forms_to_answer()}>
            {toAnswer.map((f) => (
              <Row
                key={f.collectionId}
                href={`/formulaires/${f.collectionId}`}
                title={f.name}
                meta={f.description ?? ''}
              />
            ))}
          </RowList>
        )}
      </PageSection>
      {mine.length > 0 && (
        <PageSection title={m.forms_mine()}>
          <RowList label={m.forms_mine()}>
            {mine.map((f) => (
              <Row
                key={f.collectionId}
                href={`/formulaires/${f.collectionId}`}
                title={f.name}
                meta={[m.forms_answers({ count: f.submissions }), f.open ? '' : m.forms_closed()]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </RowList>
        </PageSection>
      )}
    </AppShell>
  );
}
