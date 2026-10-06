import { Dialog, Tag } from '@kete/design';
import { useState, type ReactNode } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { fetchHow, type How, type HowStep } from './how';
import { permissionLabel } from './rights-view';
import { toolLabel } from './tool-words';

// « Comment ? » (spec 056): beside what an agent did, how it did it — who asked, each step with the
// right it used and how far it could go alone, what it read, what the journal keeps, what waits
// for its person. Only what was recorded is shown.

const levels: Record<number, () => string> = {
  1: m.agent_level_1,
  2: m.agent_level_2,
  3: m.agent_level_3,
  4: m.how_level_4,
};
const levelWords = (level: number) => levels[level]?.() ?? String(level);

const states: Record<string, () => string> = {
  done: m.tool_done,
  draft: m.how_step_draft,
  refused: m.tool_refused,
};
const stepState = (status: string) => states[status]?.() ?? status;

function Line({ at, children }: { at?: string | null; children: ReactNode }) {
  const time = at
    ? new Intl.DateTimeFormat(getLocale(), { timeStyle: 'medium' }).format(new Date(at))
    : null;
  return (
    <li className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
      <span className="text-body-sm text-fg-muted tabular-nums">{time}</span>
      <div className="grid gap-1">{children}</div>
    </li>
  );
}

function Step({ step }: { step: HowStep }) {
  const facts = [
    step.permission ? m.how_step_right({ right: permissionLabel(step.permission) }) : null,
    step.level ? m.how_step_level({ level: levelWords(step.level) }) : null,
  ].filter(Boolean);
  return (
    <Line>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{toolLabel(step.tool)}</span>
        <Tag
          tone={
            step.status === 'refused' ? 'error' : step.status === 'draft' ? 'info' : 'validated'
          }
        >
          {stepState(step.status)}
        </Tag>
      </div>
      {facts.length > 0 && <p className="text-body-sm text-fg-muted">{facts.join(' · ')}</p>}
      {step.sources && step.sources.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm">
          <li className="text-fg-muted">{m.how_step_read()}</li>
          {step.sources.map((source) => (
            <li key={source.href}>
              <a className="font-semibold text-link underline" href={source.href}>
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Line>
  );
}

function HowBody({ how }: { how: How }) {
  const day = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' }).format(
    new Date(how.askedAt),
  );
  const asked =
    how.askedBy.kind === 'agents'
      ? m.how_asked_by_agents({ names: how.askedBy.names.join(' → ') })
      : how.askedBy.reader
        ? m.how_asked_by_you()
        : m.how_asked_by_person();
  const end =
    how.status === 'done'
      ? m.how_finished()
      : how.status === 'failed'
        ? m.how_failed()
        : how.status === 'stopped'
          ? m.how_stopped()
          : null;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="font-semibold">{how.instruction}</p>
        <p className="text-body-sm text-fg-muted">{m.how_who({ agent: how.agent.name, day })}</p>
      </div>
      <ol className="rounded-box border border-line px-3">
        <Line at={how.askedAt}>
          <span>{asked}</span>
        </Line>
        {how.startedAt && (
          <Line at={how.startedAt}>
            <span>{m.how_started()}</span>
          </Line>
        )}
        {how.steps.map((step, index) => (
          <Step key={index} step={step} />
        ))}
        {how.gestures.map((gesture) => (
          <Line key={`${gesture.at}-${gesture.command}`} at={gesture.at}>
            <div className="flex flex-wrap items-center gap-2">
              <span>{gesture.summary ?? gesture.command}</span>
              <Tag tone="info">
                {gesture.reversible ? m.how_gesture_reversible() : m.how_gesture_kept()}
              </Tag>
            </div>
          </Line>
        ))}
        {end && (
          <Line at={how.finishedAt}>
            <span className="font-semibold">{end}</span>
          </Line>
        )}
      </ol>
      {how.steps.length === 0 && how.status === 'done' && (
        <p className="text-body-sm text-fg-muted">{m.how_no_step()}</p>
      )}
      {how.draftCount > 0 && (
        <a className="text-body-sm font-semibold text-link underline" href="/a-faire">
          {m.agent_task_drafts({ count: String(how.draftCount) })}
        </a>
      )}
      <div className="grid gap-1">
        <h3 className="text-body-sm font-semibold">{m.how_rights()}</h3>
        {how.rights.permissions.length === 0 ? (
          <p className="text-body-sm text-fg-muted">{m.how_rights_none()}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {how.rights.permissions.map((p) => (
              <li key={p}>
                <Tag tone="info">{permissionLabel(p)}</Tag>
              </li>
            ))}
          </ul>
        )}
        <p className="text-body-sm text-fg-muted">
          {m.how_rights_limit({ level: levelWords(Math.min(how.rights.autonomyMax, 4)) })}
        </p>
      </div>
      <p className="text-body-sm text-fg-muted">{m.how_traced()}</p>
    </div>
  );
}

/** « Comment ? » beside a task an agent did: its steps, its sources, its rights, on demand. */
export function HowButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<How | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded-control px-2 py-1 text-body-sm font-semibold text-link underline underline-offset-4 hover:bg-surface-hover"
        onClick={() => {
          setOpen(true);
          setFailed(false);
          void fetchHow({ data: { taskId } })
            .then(setHow)
            .catch(() => setFailed(true));
        }}
      >
        {m.how_ask()}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={m.how_title()}
        closeLabel={m.common_close()}
      >
        {failed ? (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {m.error_generic()}
          </p>
        ) : how ? (
          <HowBody how={how} />
        ) : (
          <p role="status" className="text-body-sm text-fg-muted">
            {m.how_reading()}
          </p>
        )}
      </Dialog>
    </>
  );
}
