import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { Chart } from './structure';

// Compliance as the API serves it (spec 008).

export type ControlStatus = 'passing' | 'failing' | 'expired' | 'missing';

export interface ComplianceScreen {
  today: string;
  checks: string[];
  frameworks: {
    frameworkId: string;
    code: string;
    name: string;
    edition: string | null;
    kind: string;
    requirements: {
      requirementId: string;
      reference: string;
      summary: string;
      controls: { controlId: string; name: string; status: ControlStatus }[];
    }[];
    certificates: {
      certificateId: string;
      body: string;
      number: string;
      issuedOn: string;
      expiresOn: string;
      nextSurveillanceOn: string | null;
    }[];
  }[];
  controls: {
    controlId: string;
    name: string;
    description: string;
    ownerPositionId: string | null;
    frequencyDays: number;
    method: 'automatic' | 'attestation';
    check: string | null;
    status: ControlStatus;
    evidence: {
      evidenceId: string;
      outcome: 'pass' | 'fail';
      summary: string;
      contentHash: string;
      collectedAt: string;
      validUntil: string;
      source: string;
    } | null;
  }[];
  documents: {
    documentId: string;
    title: string;
    kind: string;
    versions: { version: number; status: string; contentHash: string }[];
  }[];
  audits: {
    auditId: string;
    frameworkId: string | null;
    kind: string;
    plannedOn: string;
    status: string;
    conclusion: string | null;
  }[];
  findings: {
    findingId: string;
    severity: string;
    description: string;
    status: string;
    actions: {
      actionId: string;
      description: string;
      ownerUserId: string;
      dueOn: string;
      status: string;
    }[];
  }[];
  me: string;
  chart: Chart;
}

/** Compliance for whoever may read it; null otherwise. */
export const fetchCompliance = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ComplianceScreen | null> => {
    const request = getRequest();
    const { reaches } = await callApi<{ reaches: { permission: string; everywhere: boolean }[] }>(
      request,
      '/v1/rights/me',
    );
    const reads = reaches.some(
      (r) =>
        (r.permission === 'compliance:read' || r.permission === 'compliance:manage') &&
        r.everywhere,
    );
    if (!reads) return null;
    const [overview, chart, me] = await Promise.all([
      callApi<Omit<ComplianceScreen, 'me' | 'chart'>>(request, '/v1/compliance'),
      callApi<Chart>(request, '/v1/structure'),
      callApi<{ userId: string }>(request, '/v1/me'),
    ]);
    return JSON.parse(JSON.stringify({ ...overview, me: me.userId, chart })) as ComplianceScreen;
  },
);

const paths =
  /^\/(frameworks|requirements|controls|controls\/links|controls\/ctl_[0-9a-f-]+\/(collect|attest)|documents|documents\/doc_[0-9a-f-]+\/approve|audits|audits\/aud_[0-9a-f-]+\/conclude|findings|actions|actions\/cac_[0-9a-f-]+\/(complete|verify)|certificates)$/;

export const changeCompliance = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const { path, body, key } = (input ?? {}) as { path?: unknown; body?: unknown; key?: unknown };
    if (typeof path !== 'string' || !paths.test(path)) throw new Error('Unknown gesture.');
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new Error('An idempotency key is required.');
    }
    return { path, body: body ?? {}, key };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/compliance${data.path}`,
      data.body,
      data.key,
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });
