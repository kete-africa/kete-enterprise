import { Button, Drawer, PageHeader, PageSection, Tag } from '@kete/design';
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { fetchReview, performanceGesture } from '@/lib/performance';
import {
  Factors,
  GridTable,
  PersonSign,
  RecordView,
  reviewStatusLabel,
  ValidateBox,
} from '@/lib/review-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/performance/revues/$reviewId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchReview({ data: { reviewId: params.reviewId } }),
  component: ReviewPage,
});

/**
 * One review (spec 012): the grid, the measures, the factors, the record — and the gesture this
 * person may make at this step: measure, write and sign, sign, or validate.
 */
function ReviewPage() {
  const { me } = Route.useRouteContext();
  const { review, quarter } = Route.useLoaderData();
  const mine = me.personId === review.personId;
  const managing = me.personId === review.managerPersonId;
  const can = (p: string) => me.administrator || me.permissions.includes(p);
  return (
    <AppShell me={me} current={mine ? 'home' : managing ? 'team' : 'performance'}>
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_performance(), href: '/performance' }]}
        title={m.review_title({ name: review.personName })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{review.positionTitle}</Tag>
        <Tag tone={review.status === 'validated' ? 'validated' : 'info'}>
          {reviewStatusLabel(review.status)}
        </Tag>
        {review.managerName && (
          <span className="text-body-sm text-fg-muted">
            {m.review_manager({ name: review.managerName })}
          </span>
        )}
        {review.acknowledgedAt ? (
          <Tag tone="validated">{m.review_acknowledged()}</Tag>
        ) : (
          <Tag>{m.review_not_acknowledged()}</Tag>
        )}
      </div>
      <PageSection first title={m.review_factors()}>
        <Factors review={review} />
      </PageSection>
      {review.status === 'open' && quarter?.status === 'open' && can('performance:measure') && (
        <PageSection title={m.measure_title()}>
          <div>
            <a
              href={`/performance/revues/${review.reviewId}/mesures`}
              className="inline-flex h-(--control-height) items-center rounded-control bg-action text-on-action hover:bg-action-strong px-(--control-padding) font-semibold"
            >
              {m.measure_title()}
            </a>
          </div>
        </PageSection>
      )}
      <PageSection title={m.review_grid()}>
        <GridTable review={review} quarter={quarter} />
      </PageSection>
      <PageSection title={m.record_title()}>
        <div className="grid gap-4">
          {review.status === 'measured' && (managing || can('performance:manage')) && (
            <div>
              <a
                href={`/performance/revues/${review.reviewId}/bilan`}
                className="inline-flex h-(--control-height) items-center rounded-control bg-action text-on-action hover:bg-action-strong px-(--control-padding) font-semibold"
              >
                {m.record_write()}
              </a>
            </div>
          )}
          {review.status !== 'open' && review.status !== 'measured' && (
            <RecordView review={review} />
          )}
          {review.status === 'manager_signed' && mine && <SignStep reviewId={review.reviewId} />}
          {review.status === 'signed' && can('performance:validate') && (
            <ValidateBox review={review} />
          )}
          {(review.status === 'open' || review.status === 'measured') && !managing && (
            <p className="text-body-sm text-fg-muted">{m.record_waiting()}</p>
          )}
        </div>
      </PageSection>
    </AppShell>
  );
}

/** The person signs her review in a dialog, with her observations if any (spec 019). */
function SignStep({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>{m.record_sign()}</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={m.record_sign_title()}
        closeLabel={m.common_close()}
      >
        <PersonSign
          onSign={(observations) =>
            performanceGesture({
              data: {
                path: `/reviews/${reviewId}/sign`,
                body: observations ? { observations } : {},
                key: crypto.randomUUID(),
              },
            })
          }
        />
      </Drawer>
    </div>
  );
}
