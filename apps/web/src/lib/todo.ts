import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';
import type { InboxRequest } from './decisions';

// « À faire » (spec 047): a decision in full, its analysis, its discussion; the agents she may
// give a task to.

export interface Source {
  title: string;
  href: string | null;
}

export interface Analysis {
  recommendation: 'approve' | 'refuse' | 'unsure';
  confidence: 'high' | 'medium' | 'low';
  points: { text: string; source: Source | null }[];
  createdAt: string;
}

export interface Comment {
  commentId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface DecisionDetail {
  request: InboxRequest & { reference: string; measure: number | null };
  mayDecide: boolean;
  requesterName: string | null;
  analysis: Analysis | null;
  comments: Comment[];
}

const requestIdOf = (value: unknown) => {
  if (typeof value !== 'string' || !/^drq_[0-9a-f-]{8,64}$/.test(value)) {
    throw new Error('Which request?');
  }
  return value;
};

export const fetchDecision = createServerFn({ method: 'GET' })
  .validator((input: unknown) => ({
    requestId: requestIdOf((input as { requestId?: unknown } | null)?.requestId),
  }))
  .handler(async ({ data }): Promise<DecisionDetail> => {
    const d = await callApi<DecisionDetail>(getRequest(), `/v1/todo/decisions/${data.requestId}`);
    return {
      request: {
        requestId: d.request.requestId,
        subject: d.request.subject,
        subjectLabel: d.request.subjectLabel ?? null,
        title: d.request.title,
        status: d.request.status,
        createdAt: d.request.createdAt,
        currentStep: d.request.currentStep,
        overdue: d.request.overdue,
        reference: d.request.reference,
        measure: d.request.measure,
        steps: d.request.steps.map((s) => ({
          position: s.position,
          rule: s.rule,
          status: s.status,
          minMeasure: s.minMeasure,
        })),
      },
      mayDecide: d.mayDecide,
      requesterName: d.requesterName,
      analysis: d.analysis
        ? {
            recommendation: d.analysis.recommendation,
            confidence: d.analysis.confidence,
            points: d.analysis.points.map((p) => ({
              text: p.text,
              source: p.source ? { title: p.source.title, href: p.source.href } : null,
            })),
            createdAt: d.analysis.createdAt,
          }
        : null,
      comments: d.comments.map((c) => ({
        commentId: c.commentId,
        authorId: c.authorId,
        authorName: c.authorName,
        body: c.body,
        createdAt: c.createdAt,
      })),
    };
  });

/** Her assistant analyses the request; the answer is kept for her. */
export const analyseDecision = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    requestId: requestIdOf((input as { requestId?: unknown } | null)?.requestId),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/todo/decisions/${data.requestId}/analysis`,
      {},
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

export const commentDecision = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { requestId?: unknown; body?: unknown };
    return {
      requestId: requestIdOf(v.requestId),
      body: typeof v.body === 'string' ? v.body.slice(0, 2000) : '',
    };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const answer = await sendGesture(
      getRequest(),
      `/v1/todo/decisions/${data.requestId}/comments`,
      { body: data.body },
      crypto.randomUUID(),
    );
    return answer.ok ? { ok: true, error: null } : { ok: false, error: answer.error };
  });

/** Her own active agents: whom she may give a task to. */
export const fetchMyAgents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ agentId: string; name: string }[]> => {
    const request = getRequest();
    try {
      const [screen, me] = await Promise.all([
        callApi<{ agents: { agentId: string; name: string; status: string; actsFor: string }[] }>(
          request,
          '/v1/agents',
        ),
        callApi<{ userId: string }>(request, '/v1/me'),
      ]);
      return screen.agents
        .filter((a) => a.status === 'active' && a.actsFor === me.userId)
        .map((a) => ({ agentId: a.agentId, name: a.name }));
    } catch {
      return [];
    }
  },
);
