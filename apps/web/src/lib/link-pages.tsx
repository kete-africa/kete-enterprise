import { Button, Panel, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import type { LinkInfo } from './admin';
import { refusal } from './forms';
import { fetchLinkReview, linkReviewGesture, type Quarter, type Review } from './performance';
import { Factors, GridTable, PersonSign, RecordView, reviewStatusLabel } from './review-view';
import { SurveyAnswer } from './survey-answer';
import { fetchLinkSurvey, type AnswerScreen } from './surveys';
import { fetchLinkForm, submitLinkAnswers, type FormField } from './collections';
import { FormFill } from './form-fields';

/**
 * What each purpose of a personal link shows. Each business tool adds its page here: the link
 * names its purpose (`surveys.answer`, `performance.review`), never a screen address.
 */
export type LinkPageData =
  | { purpose: 'surveys.answer'; survey: AnswerScreen }
  | { purpose: 'performance.review'; review: Review; quarter: Quarter }
  | {
      purpose: 'forms.answer';
      form: { name: string; description: string | null; fields: FormField[] };
    }
  | { purpose: 'unknown'; name: string };

export async function loadLinkPage(link: LinkInfo, token: string): Promise<LinkPageData | null> {
  if (link.purpose === 'surveys.answer') {
    const survey = await fetchLinkSurvey({ data: { token } });
    return survey ? { purpose: 'surveys.answer', survey } : null;
  }
  if (link.purpose === 'forms.answer') {
    const form = await fetchLinkForm({ data: { token } });
    return form ? { purpose: 'forms.answer', form } : null;
  }
  if (link.purpose === 'performance.review') {
    const found = await fetchLinkReview({ data: { token } });
    return found ? { purpose: 'performance.review', ...found } : null;
  }
  return { purpose: 'unknown', name: link.person.name };
}

/** A review opened by link (spec 012): the grid to acknowledge, then the record to sign. */
function ReviewByLink({
  review,
  quarter,
  token,
}: {
  review: Review;
  quarter: Quarter;
  token: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-headline font-semibold">
          {m.review_link_title({ quarter: quarter.label })}
        </h1>
        <p className="text-fg-muted">
          {m.review_link_intro({ name: review.personName, position: review.positionTitle })}
        </p>
        <p className="mt-2">
          <Tag tone="info">{reviewStatusLabel(review.status)}</Tag>
        </p>
      </div>
      {!review.acknowledgedAt && (
        <Panel title={m.review_acknowledge_title()}>
          <p className="mb-3 text-body-sm">{m.review_acknowledge_explain()}</p>
          <Button
            onClick={() => {
              setError(null);
              void linkReviewGesture({
                data: { token, action: 'acknowledge', key: crypto.randomUUID() },
              }).then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                await router.invalidate();
              });
            }}
          >
            {m.review_acknowledge()}
          </Button>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </Panel>
      )}
      {review.status !== 'open' && <Factors review={review} />}
      <GridTable review={review} quarter={quarter} />
      {review.status !== 'open' && review.status !== 'measured' && <RecordView review={review} />}
      {review.status === 'manager_signed' && (
        <PersonSign
          onSign={(observations) =>
            linkReviewGesture({
              data: { token, action: 'sign', observations, key: crypto.randomUUID() },
            })
          }
        />
      )}
    </div>
  );
}

export function LinkPage({ page, token }: { page: LinkPageData; token: string }) {
  if (page.purpose === 'surveys.answer') {
    return <SurveyAnswer screen={page.survey} via={`link:${token}`} />;
  }
  if (page.purpose === 'forms.answer') {
    return <FormByLink form={page.form} token={token} />;
  }
  if (page.purpose === 'performance.review') {
    return <ReviewByLink review={page.review} quarter={page.quarter} token={token} />;
  }
  return (
    <Panel title={m.link_hello({ name: page.name })}>
      <p>{m.link_unknown_purpose()}</p>
    </Panel>
  );
}

/** A form opened by its link (spec 032): filled in without an account, then thanked. */
function FormByLink({
  form,
  token,
}: {
  form: { name: string; description: string | null; fields: FormField[] };
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={form.name}>
      {form.description && <p className="mb-4 text-fg-muted">{form.description}</p>}
      {sent ? (
        <p role="status" className="font-semibold">
          {m.forms_sent()}
        </p>
      ) : (
        <FormFill
          fields={form.fields}
          busy={busy}
          withName
          onSend={(values, name) => {
            setBusy(true);
            setError(null);
            void submitLinkAnswers({ data: { token, name, values } })
              .then((answer) => (answer.ok ? setSent(true) : setError(refusal(answer.error))))
              .catch(() => setError(m.error_generic()))
              .finally(() => setBusy(false));
          }}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </Panel>
  );
}
