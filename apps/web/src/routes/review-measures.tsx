import { PageHeader } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchReview } from '@/lib/performance';
import { MeasureForm } from '@/lib/review-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/performance/revues/$reviewId/mesures')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: ({ params }) => fetchReview({ data: { reviewId: params.reviewId } }),
  component: MeasuresPage,
});

/** The measures of a review, line by line, on their own page (spec 019): a long form. */
function MeasuresPage() {
  const { me } = Route.useRouteContext();
  const { review, readings } = Route.useLoaderData();
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
        title={m.measure_title()}
      />
      <MeasureForm review={review} readings={readings} />
    </AppShell>
  );
}
