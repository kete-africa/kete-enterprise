import { PageHeader } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchReview } from '@/lib/performance';
import { RecordForm } from '@/lib/review-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/performance/revues/$reviewId/bilan')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchReview({ data: { reviewId: params.reviewId } }),
  component: RecordPage,
});

/** The manager's record of a review, on its own page (spec 019): what was said, then signed. */
function RecordPage() {
  const { me } = Route.useRouteContext();
  const { review } = Route.useLoaderData();
  return (
    <AppShell me={me} current="performance">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[
          { label: m.nav_performance(), href: '/performance' },
          {
            label: m.review_title({ name: review.personName }),
            href: `/performance/revues/${review.reviewId}`,
          },
        ]}
        title={m.record_write()}
      />
      <div className="max-w-3xl">
        <RecordForm review={review} />
      </div>
    </AppShell>
  );
}
