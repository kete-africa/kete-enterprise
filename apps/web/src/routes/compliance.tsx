import { PageSection, PageTitle } from '@kete/design';
import { createFileRoute } from '@tanstack/react-router';
import { fetchCompliance } from '@/lib/compliance';
import { Audits, Certificates, Controls, Documents, Frameworks } from '@/lib/compliance-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/conformite')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchCompliance(),
  component: CompliancePage,
});

/**
 * Compliance (spec 008): frameworks and their requirements, shared controls and their evidence,
 * documents, audits, findings and corrective actions, certificates. Kete prepares and proves;
 * only an accredited body certifies.
 */
function CompliancePage() {
  const screen = Route.useLoaderData();
  return (
    <AppShell current="compliance">
      <PageTitle>{m.compliance_title()}</PageTitle>
      {!screen ? (
        <PageSection first>
          <p className="text-fg-muted">{m.compliance_forbidden()}</p>
        </PageSection>
      ) : (
        <>
          <PageSection first title={m.frameworks_title()}>
            <Frameworks screen={screen} />
          </PageSection>
          <PageSection title={m.controls_section()}>
            <Controls screen={screen} />
          </PageSection>
          <PageSection title={m.documents_section()}>
            <Documents screen={screen} />
          </PageSection>
          <PageSection title={m.audits_section()}>
            <Audits screen={screen} />
          </PageSection>
          <PageSection title={m.certificates_section()}>
            <Certificates screen={screen} />
          </PageSection>
        </>
      )}
    </AppShell>
  );
}
