import { Button, Panel, Tag } from '@kete/design';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { refusal } from './forms';
import {
  answerSurvey,
  type Answers,
  type AnswerScreen,
  type AnswerValue,
  type Question,
  type SurveyForm,
} from './surveys';

const choice =
  'min-h-11 min-w-11 rounded-control border px-3 text-body-sm font-semibold transition-colors';
const chosen = 'border-action bg-action text-on-action';
const idle = 'border-line-control bg-surface-control text-fg hover:bg-surface-hover';

/** One question, big enough for a thumb: 1 to 5, « not applicable », yes/no, or a text. */
function QuestionField({
  question,
  value,
  disabled,
  onChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  disabled: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  return (
    <fieldset className="grid gap-2 border-b border-line py-4 last:border-0" disabled={disabled}>
      <legend className="mb-2 font-semibold">
        {question.label}
        {question.required && <span aria-hidden="true"> *</span>}
      </legend>
      {question.type === 'rating' && (
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={value === n}
              className={`${choice} ${value === n ? chosen : idle}`}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
          {question.allowNa && (
            <button
              type="button"
              aria-pressed={value === 'na'}
              className={`${choice} ${value === 'na' ? chosen : idle}`}
              onClick={() => onChange('na')}
            >
              {m.survey_na()}
            </button>
          )}
          <span className="w-full text-body-sm text-fg-muted">{m.survey_scale()}</span>
        </div>
      )}
      {question.type === 'yes_no' && (
        <div className="flex gap-2">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={value === v}
              className={`${choice} ${value === v ? chosen : idle}`}
              onClick={() => onChange(v)}
            >
              {v ? m.survey_yes() : m.survey_no()}
            </button>
          ))}
        </div>
      )}
      {question.type === 'text' && (
        <textarea
          aria-label={question.label}
          className="min-h-24 rounded-control border border-line-control bg-surface-control p-3"
          value={typeof value === 'string' && value !== 'na' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </fieldset>
  );
}

/** One form: about nobody, or about a person; saved as a draft, then sent once. */
function FormCard({ screen, form, via }: { screen: AnswerScreen; form: SurveyForm; via: string }) {
  const [answers, setAnswers] = useState<Answers>(form.answers);
  const [status, setStatus] = useState(form.status);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = status === 'submitted';
  const send = (submit: boolean) => {
    setBusy(true);
    setMessage(null);
    void answerSurvey({
      data: { via, formId: form.formId, answers, submit, key: crypto.randomUUID() },
    })
      .then((answer) => {
        if (!answer.ok) {
          setMessage({
            tone: 'error',
            text: answer.error === 'incomplete' ? m.survey_incomplete() : refusal(answer.error),
          });
          return;
        }
        if (submit) setStatus('submitted');
        setMessage({ tone: 'ok', text: submit ? m.survey_sent() : m.survey_saved() });
      })
      .finally(() => setBusy(false));
  };
  return (
    <Panel
      title={form.aboutName ? m.survey_about({ name: form.aboutName }) : screen.campaign.title}
    >
      {sent && (
        <p className="mb-2">
          <Tag tone="validated">{m.survey_form_sent()}</Tag>
        </p>
      )}
      {screen.campaign.form.sections.map((section) => (
        <section key={section.key} className="mt-4 first:mt-0">
          <h3 className="text-body font-semibold">{section.title}</h3>
          {section.description && (
            <p className="text-body-sm text-fg-muted">{section.description}</p>
          )}
          {section.questions.map((question) => (
            <QuestionField
              key={question.key}
              question={question}
              value={answers[question.key]}
              disabled={sent || busy}
              onChange={(value) => setAnswers({ ...answers, [question.key]: value })}
            />
          ))}
        </section>
      ))}
      {!sent && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => send(true)}>
            {m.survey_send()}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => send(false)}>
            {m.survey_save()}
          </Button>
        </div>
      )}
      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 text-body-sm ${message.tone === 'error' ? 'text-state-error-fg' : 'text-state-success-fg'}`}
        >
          {message.text}
        </p>
      )}
    </Panel>
  );
}

/**
 * What a respondent fills in (spec 011), by account or by link: her forms of one campaign. Phone
 * first: one column, large choices, nothing else of the organization.
 */
export function SurveyAnswer({ screen, via }: { screen: AnswerScreen; via: string }) {
  const closes = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(
    new Date(`${screen.campaign.closesOn}T12:00:00Z`),
  );
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-headline font-semibold">{screen.campaign.title}</h1>
        <p className="text-fg-muted">
          {m.survey_intro({ name: screen.respondent.name, period: screen.campaign.period, closes })}
        </p>
        <p className="mt-2 text-body-sm">
          {screen.campaign.anonymous ? m.survey_anonymous() : m.survey_named()}
        </p>
      </div>
      {screen.forms.map((form) => (
        <FormCard key={form.formId} screen={screen} form={form} via={via} />
      ))}
    </div>
  );
}
