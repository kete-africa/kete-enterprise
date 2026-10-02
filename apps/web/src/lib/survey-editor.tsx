import { Button, Panel, TextField } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { refusal, Select } from './forms';
import type { Chart } from './structure';
import {
  manageSurveys,
  type Audience,
  type FormContent,
  type Question,
  type Questionnaire,
  type Section,
} from './surveys';

const slug = (prefix: string, index: number) => `${prefix}${index + 1}`;

/** Keys follow the order: s1, s1_q1… — stable enough for a draft, rewritten on save. */
function withKeys(sections: Section[]): FormContent {
  return {
    sections: sections.map((section, s) => ({
      ...section,
      key: slug('s', s),
      questions: section.questions.map((q, i) => ({ ...q, key: `${slug('s', s)}_q${i + 1}` })),
    })),
  };
}

const emptyQuestion = (): Question => ({
  key: '',
  type: 'rating',
  label: '',
  required: true,
  allowNa: true,
});

/** Writes a questionnaire: its sections (possibly about a unit) and their questions. */
export function QuestionnaireEditor({
  questionnaire,
  chart,
  onDone,
}: {
  questionnaire: Questionnaire | null;
  chart: Chart;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(questionnaire?.title ?? '');
  const [anonymous, setAnonymous] = useState(questionnaire?.anonymous ?? true);
  const [sections, setSections] = useState<Section[]>(
    questionnaire?.content.sections ?? [{ key: 's1', title: '', questions: [emptyQuestion()] }],
  );
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, next: Partial<Section>) =>
    setSections(sections.map((s, i) => (i === index ? { ...s, ...next } : s)));
  const updateQuestion = (s: number, q: number, next: Partial<Question>) =>
    update(s, {
      questions: (sections[s]?.questions ?? []).map((x, i) => (i === q ? { ...x, ...next } : x)),
    });
  const ready =
    title.trim().length > 0 &&
    sections.every(
      (s) => s.title.trim() && s.questions.length > 0 && s.questions.every((q) => q.label.trim()),
    );
  return (
    <Panel title={questionnaire ? m.questionnaire_edit() : m.questionnaire_new()}>
      <div className="grid gap-4">
        <TextField
          label={m.field_title()}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          {m.questionnaire_anonymous()}
        </label>
        {sections.map((section, s) => (
          <div key={s} className="grid gap-3 rounded-box border border-line p-4">
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                className="min-w-64 flex-1"
                label={m.questionnaire_section({ n: String(s + 1) })}
                value={section.title}
                onChange={(e) => update(s, { title: e.target.value })}
              />
              <Select
                label={m.questionnaire_about_unit()}
                value={section.unitId ?? ''}
                onChange={(e) => {
                  const next: Section = { ...section };
                  if (e.target.value) next.unitId = e.target.value;
                  else delete next.unitId;
                  setSections(sections.map((x, i) => (i === s ? next : x)));
                }}
              >
                <option value="">{m.field_nobody()}</option>
                {chart.units.map((u) => (
                  <option key={u.unitId} value={u.unitId}>
                    {u.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={sections.length === 1}
                onClick={() => setSections(sections.filter((_, i) => i !== s))}
              >
                {m.remove()}
              </Button>
            </div>
            {section.questions.map((question, q) => (
              <div key={q} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
                <TextField
                  className="min-w-72 flex-1"
                  label={m.questionnaire_question({ n: String(q + 1) })}
                  value={question.label}
                  onChange={(e) => updateQuestion(s, q, { label: e.target.value })}
                />
                <Select
                  label={m.questionnaire_type()}
                  value={question.type}
                  onChange={(e) =>
                    updateQuestion(s, q, { type: e.target.value as Question['type'] })
                  }
                >
                  <option value="rating">{m.question_rating()}</option>
                  <option value="yes_no">{m.question_yes_no()}</option>
                  <option value="text">{m.question_text()}</option>
                </Select>
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(e) => updateQuestion(s, q, { required: e.target.checked })}
                  />
                  {m.question_required()}
                </label>
                <Button
                  variant="secondary"
                  disabled={section.questions.length === 1}
                  onClick={() =>
                    update(s, { questions: section.questions.filter((_, i) => i !== q) })
                  }
                >
                  {m.remove()}
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                onClick={() => update(s, { questions: [...section.questions, emptyQuestion()] })}
              >
                {m.questionnaire_add_question()}
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              setSections([...sections, { key: '', title: '', questions: [emptyQuestion()] }])
            }
          >
            {m.questionnaire_add_section()}
          </Button>
          <Button
            disabled={!ready}
            onClick={() => {
              setError(null);
              void manageSurveys({
                data: {
                  path: '/questionnaires',
                  key: crypto.randomUUID(),
                  body: {
                    ...(questionnaire ? { questionnaireId: questionnaire.questionnaireId } : {}),
                    title,
                    anonymous,
                    content: withKeys(sections),
                  },
                },
              }).then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                onDone();
                await router.invalidate();
              });
            }}
          >
            {m.form_save()}
          </Button>
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

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Prepares a campaign: a questionnaire, a period, an audience, and about whom. */
export function CampaignForm({
  questionnaires,
  chart,
  onDone,
}: {
  questionnaires: Questionnaire[];
  chart: Chart;
  onDone: (campaignId: string) => void;
}) {
  const [draft, setDraft] = useState({
    questionnaireId: questionnaires[0]?.questionnaireId ?? '',
    title: '',
    period: '',
    opensOn: today(),
    closesOn: inDays(14),
    audience: 'everyone' as Audience['kind'],
    unitId: '',
    outside: '',
    about: 'none' as 'none' | 'manager' | 'reports' | 'person',
    aboutPersonId: '',
    minGroup: '3',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (next: Partial<typeof draft>) => setDraft({ ...draft, ...next });
  const outside = draft.outside
    .split(/\r?\n/)
    .map((line) => line.split(/;|\t/).map((x) => x.trim()))
    .filter(([name, email]) => name && email)
    .map(([name = '', email = '']) => ({ name, email }));
  const audience: Audience =
    draft.audience === 'units'
      ? { kind: 'units', unitIds: draft.unitId ? [draft.unitId] : [] }
      : draft.audience === 'outside'
        ? { kind: 'outside', people: outside }
        : { kind: 'everyone' };
  const ready =
    draft.questionnaireId &&
    draft.title.trim() &&
    draft.period.trim() &&
    (draft.audience !== 'units' || draft.unitId) &&
    (draft.audience !== 'outside' || outside.length > 0) &&
    (draft.about !== 'person' || draft.aboutPersonId);
  return (
    <Panel title={m.campaign_new()}>
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label={m.campaign_questionnaire()}
          value={draft.questionnaireId}
          onChange={(e) => set({ questionnaireId: e.target.value })}
        >
          {questionnaires.map((q) => (
            <option key={q.questionnaireId} value={q.questionnaireId}>
              {q.title} — v{q.version}
            </option>
          ))}
        </Select>
        <TextField
          label={m.field_title()}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <TextField
          label={m.campaign_period()}
          hint={m.campaign_period_hint()}
          value={draft.period}
          onChange={(e) => set({ period: e.target.value })}
        />
        <div className="flex gap-3">
          <TextField
            label={m.campaign_opens()}
            type="date"
            value={draft.opensOn}
            onChange={(e) => set({ opensOn: e.target.value })}
          />
          <TextField
            label={m.campaign_closes()}
            type="date"
            value={draft.closesOn}
            onChange={(e) => set({ closesOn: e.target.value })}
          />
        </div>
        <Select
          label={m.campaign_audience()}
          value={draft.audience}
          onChange={(e) => set({ audience: e.target.value as Audience['kind'] })}
        >
          <option value="everyone">{m.audience_everyone()}</option>
          <option value="units">{m.audience_units()}</option>
          <option value="outside">{m.audience_outside()}</option>
        </Select>
        {draft.audience === 'units' && (
          <Select
            label={m.field_unit()}
            value={draft.unitId}
            onChange={(e) => set({ unitId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {chart.units.map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
        {draft.audience === 'outside' ? (
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg md:col-span-2">
            {m.audience_outside_list()}
            <textarea
              className="min-h-28 rounded-control border border-line-control bg-surface-control p-3 font-mono font-normal"
              value={draft.outside}
              onChange={(e) => set({ outside: e.target.value })}
            />
          </label>
        ) : (
          <Select
            label={m.campaign_about()}
            value={draft.about}
            onChange={(e) => set({ about: e.target.value as typeof draft.about })}
          >
            <option value="none">{m.about_none()}</option>
            <option value="manager">{m.about_manager()}</option>
            <option value="reports">{m.about_reports()}</option>
            <option value="person">{m.about_person()}</option>
          </Select>
        )}
        {draft.about === 'person' && draft.audience !== 'outside' && (
          <Select
            label={m.field_person()}
            value={draft.aboutPersonId}
            onChange={(e) => set({ aboutPersonId: e.target.value })}
          >
            <option value="">{m.field_choose()}</option>
            {chart.people.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <TextField
          label={m.campaign_min_group()}
          hint={m.campaign_min_group_hint()}
          type="number"
          min={1}
          max={20}
          value={draft.minGroup}
          onChange={(e) => set({ minGroup: e.target.value })}
        />
      </div>
      <div className="mt-4">
        <Button
          disabled={!ready}
          onClick={() => {
            setError(null);
            void manageSurveys({
              data: {
                path: '/campaigns',
                key: crypto.randomUUID(),
                body: {
                  questionnaireId: draft.questionnaireId,
                  title: draft.title,
                  period: draft.period,
                  opensOn: draft.opensOn,
                  closesOn: draft.closesOn,
                  audience,
                  about: draft.audience === 'outside' ? 'none' : draft.about,
                  ...(draft.about === 'person' ? { aboutPersonId: draft.aboutPersonId } : {}),
                  minGroup: Number(draft.minGroup) || 3,
                },
              },
            }).then((answer) => {
              if (!answer.ok) return setError(refusal(answer.error));
              onDone(String(answer.data?.campaignId ?? ''));
            });
          }}
        >
          {m.campaign_prepare()}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </Panel>
  );
}
