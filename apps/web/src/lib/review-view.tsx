import { AppCard, AppGrid, Button, Icon, Panel, Tag, TextField, type TagTone } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { refusal, Select } from './forms';
import {
  percent,
  performanceGesture,
  type Colour,
  type Quarter,
  type Reading,
  type Review,
  type ReviewLine,
  type ReviewStatus,
} from './performance';

export function colourTag(colour: Colour | null): ReactNode {
  if (!colour) return <Tag>{m.colour_none()}</Tag>;
  const tone: Record<Colour, TagTone> = { green: 'validated', orange: 'verify', red: 'error' };
  const label = { green: m.colour_green, orange: m.colour_orange, red: m.colour_red }[colour];
  return <Tag tone={tone[colour]}>{label()}</Tag>;
}

export function reviewStatusLabel(status: ReviewStatus): string {
  return {
    open: m.review_open,
    measured: m.review_measured,
    manager_signed: m.review_manager_signed,
    signed: m.review_signed,
    validated: m.review_validated,
    missed: m.review_missed,
  }[status]();
}

const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '';

function kindLabel(line: ReviewLine): string | null {
  if (line.kind === 'malus') return m.line_malus();
  if (line.kind === 'penalizing') return m.line_penalizing();
  if (line.kind === 'blocking') return m.line_blocking();
  return null;
}

/**
 * The grid of a review with its six attributes, then what the quarter measured: value, proof,
 * colour. Its words are those of the referential, frozen when the quarter opened.
 */
export function GridTable({ review, quarter }: { review: Review; quarter: Quarter | null }) {
  return (
    <div className="grid gap-3">
      {review.lines.map((line) => (
        <div key={line.position} className="rounded-box border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{line.name}</p>
              <p className="text-body-sm text-fg-muted">{line.formula}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {kindLabel(line) && <Tag tone="verify">{kindLabel(line)}</Tag>}
              {quarter?.progressive && !line.reliable && <Tag>{m.line_observation()}</Tag>}
              <Tag>{line.weight === null ? m.line_out_of_sum() : percent(line.weight)}</Tag>
            </div>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-body-sm sm:grid-cols-4">
            <div>
              <dt className="text-fg-muted">{m.line_source()}</dt>
              <dd>{line.source}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{m.line_frequency()}</dt>
              <dd>{line.frequency}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{m.line_target()}</dt>
              <dd>{line.targetText}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{m.line_threshold()}</dt>
              <dd>{line.thresholdText}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-body-sm">
            <span>
              {m.line_value()}{' '}
              <span className="font-number font-semibold">{line.value ?? '—'}</span>
            </span>
            {line.kind !== 'malus' && colourTag(line.colour)}
            {line.proof && (
              <span className="text-fg-muted">{m.line_proof({ proof: line.proof })}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The factors of a review: individual, collective, group, and the quarter's factor. */
export function Factors({ review }: { review: Review }) {
  const split = review.weights;
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      {[
        {
          label: m.factor_individual({ weight: percent(split.individual) }),
          value: review.individual,
        },
        {
          label: m.factor_collective({
            label: split.collectiveLabel ?? m.factor_collective_default(),
            weight: percent(split.collective),
          }),
          value: review.collective,
        },
        { label: m.factor_group({ weight: percent(split.group) }), value: review.group },
        { label: m.factor_total(), value: review.factor },
      ].map((item, i) => (
        <div
          key={i}
          className={`rounded-box border p-4 ${i === 3 ? 'border-accent bg-surface-raised' : 'border-line bg-surface'}`}
        >
          <p className="text-body-sm text-fg-muted">{item.label}</p>
          <p className="font-number text-title font-semibold">{percent(item.value)}</p>
        </div>
      ))}
      {review.fallback && (
        <p className="text-body-sm text-state-verify-fg sm:col-span-4">{m.factor_fallback()}</p>
      )}
    </div>
  );
}

function useGesture() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (path: string, body: object, done?: () => void) => {
    setBusy(true);
    setError(null);
    void performanceGesture({ data: { path, body, key: crypto.randomUUID() } })
      .then(async (answer) => {
        if (!answer.ok) return setError(refusal(answer.error));
        done?.();
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };
  return { busy, error, run };
}

function Alert({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-3 text-body-sm text-state-error-fg">
      {error}
    </p>
  ) : null;
}

/** Management control enters each line's value, its colour when the target is words, its proof. */
export function MeasureForm({ review, readings = [] }: { review: Review; readings?: Reading[] }) {
  const { busy, error, run } = useGesture();
  const [draft, setDraft] = useState(
    Object.fromEntries(
      review.lines.map((l) => [
        l.position,
        {
          value: l.value === null ? '' : String(l.value),
          colour: l.colour ?? '',
          proof: l.proof ?? '',
        },
      ]),
    ) as Record<number, { value: string; colour: string; proof: string }>,
  );
  return (
    <Panel title={m.measure_title()}>
      <div className="grid gap-3">
        {review.lines.map((line) => {
          const entry = draft[line.position] ?? { value: '', colour: '', proof: '' };
          const set = (next: Partial<typeof entry>) =>
            setDraft({ ...draft, [line.position]: { ...entry, ...next } });
          return (
            <div
              key={line.position}
              className="flex flex-wrap items-end gap-3 border-b border-line pb-3"
            >
              <span className="min-w-56 flex-1 text-body-sm font-semibold">
                {line.name}
                {readings
                  .filter((r) => r.indicator === line.name)
                  .map((r) => (
                    <span
                      key={r.readingId}
                      className="mt-1 flex flex-wrap items-center gap-2 font-normal"
                    >
                      <Tag tone="info">
                        {m.reading_from({ source: r.source, value: String(r.value) })}
                      </Tag>
                      <button
                        type="button"
                        className="text-link underline"
                        disabled={busy}
                        onClick={() =>
                          run(`/reviews/${review.reviewId}/from-reading`, {
                            position: line.position,
                            readingId: r.readingId,
                          })
                        }
                      >
                        {m.reading_take()}
                      </button>
                    </span>
                  ))}
              </span>
              <TextField
                className="w-32"
                label={line.kind === 'malus' ? m.measure_incidents() : m.line_value()}
                type="number"
                step="any"
                value={entry.value}
                onChange={(e) => set({ value: e.target.value })}
              />
              {line.direction === null && line.kind !== 'malus' && (
                <Select
                  label={m.measure_colour()}
                  value={entry.colour}
                  onChange={(e) => set({ colour: e.target.value })}
                >
                  <option value="">{m.field_choose()}</option>
                  <option value="green">{m.colour_green()}</option>
                  <option value="orange">{m.colour_orange()}</option>
                  <option value="red">{m.colour_red()}</option>
                </Select>
              )}
              <TextField
                className="min-w-56 flex-1"
                label={m.measure_proof()}
                value={entry.proof}
                onChange={(e) => set({ proof: e.target.value })}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <Button
          disabled={busy}
          onClick={() =>
            run(`/reviews/${review.reviewId}/measures`, {
              lines: review.lines
                .map((line) => ({ line, entry: draft[line.position] }))
                .filter(({ entry }) => entry && (entry.value !== '' || entry.colour !== ''))
                .map(({ line, entry }) => ({
                  position: line.position,
                  value: entry?.value === '' ? null : Number(entry?.value),
                  ...(entry?.colour ? { colour: entry.colour } : {}),
                  ...(entry?.proof ? { proof: entry.proof } : {}),
                })),
            })
          }
        >
          {m.form_save()}
        </Button>
      </div>
      <Alert error={error} />
    </Panel>
  );
}

/** The record of the review: what was said, who signed and when, and the person's observations. */
export function RecordView({ review }: { review: Review }) {
  const rows: [string, string | undefined][] = [
    [m.record_facts(), review.record.facts],
    [m.record_difficulties(), review.record.difficulties],
    [m.record_support(), review.record.support],
  ];
  return (
    <Panel title={m.record_title()}>
      <dl className="grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-body-sm text-fg-muted">{label}</dt>
            <dd className="whitespace-pre-line">{value || '—'}</dd>
          </div>
        ))}
        <div>
          <dt className="text-body-sm text-fg-muted">{m.record_protocols()}</dt>
          <dd>
            {review.record.protocols === null || review.record.protocols === undefined
              ? '—'
              : `${review.record.protocols} %`}
          </dd>
        </div>
        {review.personObservations && (
          <div>
            <dt className="text-body-sm text-fg-muted">{m.record_observations()}</dt>
            <dd className="whitespace-pre-line">{review.personObservations}</dd>
          </div>
        )}
      </dl>
      <ul className="mt-4 grid gap-1 border-t border-line pt-3 text-body-sm">
        <li>
          {review.managerSignedAt
            ? m.record_signed_by_manager({
                name: review.managerName ?? '',
                when: when(review.managerSignedAt),
              })
            : m.record_not_signed_manager()}
        </li>
        <li>
          {review.personSignedAt
            ? m.record_signed_by_person({
                name: review.personName,
                when: when(review.personSignedAt),
              })
            : m.record_not_signed_person()}
        </li>
        {review.validatedAt && <li>{m.record_validated({ when: when(review.validatedAt) })}</li>}
      </ul>
    </Panel>
  );
}

/** The manager writes the record, then signs it: the person is told by link. */
export function RecordForm({ review }: { review: Review }) {
  const { busy, error, run } = useGesture();
  const [draft, setDraft] = useState({
    facts: review.record.facts ?? '',
    difficulties: review.record.difficulties ?? '',
    support: review.record.support ?? '',
    protocols:
      review.record.protocols === null || review.record.protocols === undefined
        ? ''
        : String(review.record.protocols),
  });
  const area = (label: string, key: 'facts' | 'difficulties' | 'support') => (
    <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
      {label}
      <textarea
        className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  const body = {
    facts: draft.facts,
    difficulties: draft.difficulties,
    support: draft.support,
    protocols: draft.protocols === '' ? null : Number(draft.protocols),
  };
  return (
    <Panel title={m.record_write()}>
      <div className="grid gap-4">
        {area(m.record_facts(), 'facts')}
        {area(m.record_difficulties(), 'difficulties')}
        {area(m.record_support(), 'support')}
        <TextField
          className="max-w-56"
          label={m.record_protocols()}
          hint={m.record_protocols_hint()}
          type="number"
          min={0}
          max={100}
          value={draft.protocols}
          onChange={(e) => setDraft({ ...draft, protocols: e.target.value })}
        />
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(`/reviews/${review.reviewId}/record`, body)}
          >
            {m.form_save()}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(`/reviews/${review.reviewId}/record`, body, () =>
                run(`/reviews/${review.reviewId}/sign`, {}),
              )
            }
          >
            {m.record_save_and_sign()}
          </Button>
        </div>
        <Alert error={error} />
      </div>
    </Panel>
  );
}

/** The person signs her review — by account here, or by link — with her observations if any. */
export function PersonSign({
  onSign,
}: {
  onSign: (observations: string) => Promise<{ ok: boolean; error: string | null }>;
}) {
  const router = useRouter();
  const [observations, setObservations] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={m.record_sign_title()}>
      <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
        {m.record_observations()}
        <textarea
          className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
        />
      </label>
      <div className="mt-3">
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSign(observations)
              .then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                await router.invalidate();
              })
              .finally(() => setBusy(false));
          }}
        >
          {m.record_sign()}
        </Button>
      </div>
      <Alert error={error} />
    </Panel>
  );
}

/** HR validates a review signed by both: its factors are frozen. */
export function ValidateBox({ review }: { review: Review }) {
  const { busy, error, run } = useGesture();
  return (
    <Panel title={m.validate_title()}>
      <p className="mb-3 text-body-sm text-fg-muted">{m.validate_explain()}</p>
      <Button disabled={busy} onClick={() => run(`/reviews/${review.reviewId}/validate`, {})}>
        {m.validate_action()}
      </Button>
      <Alert error={error} />
    </Panel>
  );
}

export function quarterStatusLabel(status: Quarter['status']): string {
  return {
    draft: m.quarter_draft,
    open: m.quarter_open,
    measured: m.quarter_measured,
    closed: m.quarter_closed,
  }[status]();
}

export function ReviewCards({ reviews, mine }: { reviews: Review[]; mine?: boolean }) {
  return (
    <AppGrid layout="list">
      {reviews.map((r) => (
        <AppCard
          key={r.reviewId}
          href={`/performance/revues/${r.reviewId}`}
          icon={<Icon name="learn" />}
          name={mine ? r.positionTitle : r.personName}
          description={m.review_card({
            status: reviewStatusLabel(r.status),
            factor: percent(r.factor),
            reds: String(r.lines.filter((l) => l.colour === 'red').length),
          })}
        />
      ))}
    </AppGrid>
  );
}
