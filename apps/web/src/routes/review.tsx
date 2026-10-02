import { PageSection, PageTitle, Tag } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchReview, performanceGesture } from '@/lib/performance';
import {
  Factors,
  GridTable,
  MeasureForm,
  PersonSign,
  RecordForm,
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
  const { review, quarter, readings } = Route.useLoaderData();
  const mine = me.personId === review.personId;
  const managing = me.personId === review.managerPersonId;
  const can = (p: string) => me.administrator || me.permissions.includes(p);
  return (
    <AppShell me={me} current={mine ? 'home' : managing ? 'team' : 'performance'}>
      <PageTitle>{m.review_title({ name: review.personName })}</PageTitle>
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
          <MeasureForm review={review} readings={readings} />
        </PageSection>
      )}
      <PageSection title={m.review_grid()}>
        <GridTable review={review} quarter={quarter} />
      </PageSection>
      <PageSection title={m.record_title()}>
        <div className="grid gap-4">
          {review.status === 'measured' && (managing || can('performance:manage')) && (
            <RecordForm review={review} />
          )}
          {review.status !== 'open' && review.status !== 'measured' && (
            <RecordView review={review} />
          )}
          {review.status === 'manager_signed' && mine && (
            <PersonSign
              onSign={(observations) =>
                performanceGesture({
                  data: {
                    path: `/reviews/${review.reviewId}/sign`,
                    body: observations ? { observations } : {},
                    key: crypto.randomUUID(),
                  },
                })
              }
            />
          )}
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
