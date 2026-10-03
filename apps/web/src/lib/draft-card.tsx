import { Button, VerificationCard } from '@kete/design';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { refusal } from './forms';
import { decideDraft, type DraftReview } from './workspace';

/** The words of a draft's fields: the catalog's when the field is known, its name otherwise. */
function fieldLabel(key: string): string {
  const labels: Record<string, () => string> = {
    title: m.actions_field_title,
    responsiblePersonId: m.actions_field_owner,
    dueOn: m.actions_field_due,
    detail: m.actions_field_detail,
    reviewId: m.draft_field_review,
    position: m.draft_field_line,
    readingId: m.draft_field_reading,
  };
  return labels[key]?.() ?? key;
}

function draftTitle(draft: DraftReview): string {
  const titles: Record<string, () => string> = {
    action: m.draft_title_action,
    'review-measure': m.draft_title_measure,
  };
  return titles[draft.recordType]?.() ?? draft.capability;
}

/**
 * A draft an agent prepared (spec 017): each value with where it comes from, and the person's
 * decision — validate (the same command as her screen runs) or refuse. An agent never decides.
 */
export function DraftCard({
  draft,
  onDecided,
}: {
  draft: DraftReview;
  onDecided?: (status: 'validated' | 'refused') => void;
}) {
  const [status, setStatus] = useState(draft.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = (action: 'validate' | 'refuse') => {
    setBusy(true);
    setError(null);
    void decideDraft({ data: { draftId: draft.draftId, action } })
      .then((answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        const decided = action === 'validate' ? 'validated' : 'refused';
        setStatus(decided);
        onDecided?.(decided);
      })
      .finally(() => setBusy(false));
  };
  const fields = Object.entries(draft.values).map(([key, value]) => {
    const provenance = draft.provenance[key];
    return {
      label: fieldLabel(key),
      value: draft.display?.[key] ?? (value === null || value === undefined ? '—' : String(value)),
      provenance:
        provenance?.source === 'inferred' || !provenance
          ? m.draft_from_assistant()
          : provenance.source,
      uncertain: provenance?.certainty === 'low',
    };
  });
  return (
    <div className="grid gap-2">
      <VerificationCard
        title={draftTitle(draft)}
        state={
          status === 'prepared'
            ? { name: 'prepared', label: m.draft_prepared() }
            : status === 'validated'
              ? { name: 'verified', label: m.draft_validated() }
              : { name: 'refused', label: m.draft_refused() }
        }
        fields={fields}
        {...(status === 'prepared'
          ? {
              actions: (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => decide('validate')}>
                    {m.draft_validate()}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => decide('refuse')}>
                    {m.draft_refuse()}
                  </Button>
                </div>
              ),
            }
          : {})}
      />
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </div>
  );
}
