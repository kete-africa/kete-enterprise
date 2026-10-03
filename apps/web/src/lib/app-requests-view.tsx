import { Row, RowList, Tag, type TagTone } from '@kete/design';
import type { AppRequest, AppRequestStatus, Criticality, DataCategory } from '@/lib/app-requests';
import * as m from '@/paraglide/messages.js';

// The words and marks of app requests (spec 021), shared by their screens.

const statusWords: Record<AppRequestStatus, () => string> = {
  submitted: m.apr_status_submitted,
  refused: m.apr_status_refused,
  withdrawn: m.apr_status_withdrawn,
  queued: m.apr_status_queued,
  building: m.apr_status_building,
  ready: m.apr_status_ready,
  coding: m.apr_status_coding,
  review: m.apr_status_review,
  failed: m.apr_status_failed,
};

const statusTone: Record<AppRequestStatus, TagTone> = {
  submitted: 'verify',
  refused: 'neutral',
  withdrawn: 'neutral',
  queued: 'info',
  building: 'info',
  ready: 'validated',
  coding: 'agent',
  review: 'verify',
  failed: 'error',
};

export function StatusTag({ status }: { status: AppRequestStatus }) {
  return <Tag tone={statusTone[status]}>{statusWords[status]()}</Tag>;
}

export const dataWords: Record<DataCategory, () => string> = {
  none: m.data_none,
  personal: m.data_personal,
  special: m.data_special,
  children: m.data_children,
  financial: m.data_financial,
  payment: m.data_payment,
  location: m.data_location,
  credentials: m.data_credentials,
  confidential: m.data_confidential,
};

export const criticalityWords: Record<Criticality, () => string> = {
  low: m.criticality_low,
  medium: m.criticality_medium,
  high: m.criticality_high,
  critical: m.criticality_critical,
};

export const dataLabel = (category: string) =>
  (dataWords[category as DataCategory] ?? (() => category))();

const day = (iso: string) => iso.slice(0, 10);

/** Requests as rows, each opening its own page. */
export function RequestRows({ requests, empty }: { requests: AppRequest[]; empty: string }) {
  if (requests.length === 0) return <p className="text-fg-muted">{empty}</p>;
  return (
    <RowList label={m.apr_title()}>
      {requests.map((r) => (
        <Row
          key={r.requestId}
          href={`/ressources/demandes/${r.requestId}`}
          title={r.name}
          meta={`${r.requesterName} · ${day(r.createdAt)} · kete-${r.slug}`}
          end={<StatusTag status={r.status} />}
        />
      ))}
    </RowList>
  );
}
