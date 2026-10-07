import { Button, Icon, Tag } from '@kete/design';
import { useEffect, useState, type ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { kindIcon, kindLabel, why } from './day';
import type { DayItem, Meanwhile } from './today';

// « Aujourd'hui » as a session (spec 058): one subject at a time, with its gesture, « Plus tard
// aujourd'hui » and « Passer »; and « Pendant ce temps », what her agents and routines are doing.

const STORE = 'kete.today.session';

/**
 * The session of this browser tab: the subjects it started with. Kept in the tab so that she
 * finds her session again when she comes back from the subject she opened.
 */
export function useSession() {
  const [started, setStarted] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const kept: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? 'null');
      if (Array.isArray(kept) && kept.every((k) => typeof k === 'string')) setStarted(kept);
    } catch {
      // A tab without storage has no session to find again.
    }
  }, []);
  return {
    started,
    start(keys: string[]) {
      setStarted(keys);
      try {
        sessionStorage.setItem(STORE, JSON.stringify(keys));
      } catch {
        // The session then lives as long as the page.
      }
    },
    end() {
      setStarted(null);
      try {
        sessionStorage.removeItem(STORE);
      } catch {
        // Nothing was kept.
      }
    },
  };
}

export interface SessionCounts {
  settled: number;
  later: number;
  remaining: number;
}

/** The subject in front of her, or the end of the session when nothing remains. */
export function SessionCard({
  item,
  counts,
  gestures,
  busy,
  onLater,
  onSkip,
  onEnd,
}: {
  item: DayItem | null;
  counts: SessionCounts;
  /** The subject's own gestures: open it, decide it, validate it. */
  gestures: ReactNode;
  busy: boolean;
  onLater: () => void;
  onSkip: () => void;
  onEnd: () => void;
}) {
  const progress = m.session_progress({
    settled: String(counts.settled),
    later: String(counts.later),
    remaining: String(counts.remaining),
  });
  if (!item) {
    return (
      <section
        aria-label={m.session_label()}
        className="grid gap-3 rounded-box border border-line bg-surface p-5"
      >
        <h3 className="text-title font-semibold">{m.session_done_title()}</h3>
        <p role="status">
          {m.session_done({ settled: String(counts.settled), later: String(counts.later) })}
        </p>
        <div>
          <Button onClick={onEnd}>{m.session_close()}</Button>
        </div>
      </section>
    );
  }
  return (
    <section
      aria-label={m.session_label()}
      className="grid gap-4 rounded-box border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-body-sm font-semibold text-fg-muted">
          {progress}
        </p>
        <button
          type="button"
          className="rounded-control px-2 py-1 text-body-sm font-semibold text-fg hover:bg-surface-hover"
          onClick={onEnd}
        >
          {m.session_end()}
        </button>
      </div>
      <div className="flex items-start gap-4">
        <span
          className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full ${
            item.overdue
              ? 'bg-state-error-surface text-state-error-fg'
              : 'bg-surface-selected text-fg-muted'
          }`}
        >
          <Icon name={kindIcon[item.kind]} size={22} />
        </span>
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag tone={item.overdue ? 'error' : 'info'}>
              {item.overdue ? m.today_overdue() : kindLabel(item.kind)}
            </Tag>
          </div>
          <h3 className="text-title font-semibold">{item.title}</h3>
          <p className="text-fg-muted">{why(item)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {gestures}
        <Button variant="secondary" disabled={busy} onClick={onLater}>
          {m.session_later()}
        </Button>
        {counts.remaining > 1 && (
          <Button variant="secondary" disabled={busy} onClick={onSkip}>
            {m.session_skip()}
          </Button>
        )}
      </div>
    </section>
  );
}

const linkClass = 'text-body-sm font-semibold text-link underline';

/** « Pendant ce temps »: what her agents and her routines are doing right now. */
export function MeanwhileList({ meanwhile }: { meanwhile: Meanwhile }) {
  const state = (status: 'queued' | 'running') =>
    status === 'running' ? m.meanwhile_running() : m.meanwhile_queued();
  if (meanwhile.agents.length + meanwhile.routines.length === 0) {
    return <p className="text-fg-muted">{m.meanwhile_none()}</p>;
  }
  return (
    <div className="grid gap-3">
      <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
        {meanwhile.agents.map((task) => (
          <li key={task.taskId} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Tag tone="agent">{task.agentName}</Tag>
            <span className="min-w-0 flex-1 basis-60">{task.instruction}</span>
            <Tag tone="info">{state(task.status)}</Tag>
          </li>
        ))}
        {meanwhile.routines.map((run) => (
          <li key={run.runId} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Tag tone="neutral">{m.meanwhile_routine()}</Tag>
            <span className="flex min-w-0 flex-1 basis-60 flex-col">
              <span>{run.title}</span>
              <span className="text-body-sm text-fg-muted">{run.cause}</span>
            </span>
            <Tag tone="info">{state(run.status)}</Tag>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap gap-4">
        {meanwhile.agents.length > 0 && (
          <a className={linkClass} href="/mes-agents">
            {m.meanwhile_see_agents()}
          </a>
        )}
        {meanwhile.routines.length > 0 && (
          <a className={linkClass} href="/routines">
            {m.meanwhile_see_routines()}
          </a>
        )}
      </p>
    </div>
  );
}
