import { PageSection, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ObjectEvent } from '@/lib/objects';
import { getLocale } from '@/paraglide/runtime.js';
import * as m from '@/paraglide/messages.js';

// An object's history and its live screen (spec 101; canvas v7, « Un objet », « Son histoire »):
// what the event path recorded about it — its birth, each change of state, the apps' facts that
// name it — the latest first. Each line says where it comes from.

/** The screen open on an object reads it again when it changes. */
export function useObjectLive(kind: string, id: string) {
  const router = useRouter();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/objets/${kind}/${encodeURIComponent(id)}/flux`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener('object', () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void router.invalidate();
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [kind, id, router]);
}

const when = (value: string) => {
  const at = new Date(value);
  const today = new Date().toDateString() === at.toDateString();
  return new Intl.DateTimeFormat(
    getLocale(),
    today ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' },
  ).format(at);
};

const dot: Record<string, string> = {
  app: 'bg-state-info-fg',
  created: 'bg-fg-muted',
  changed: 'bg-state-verify-fg',
};

export function ObjectHistory({
  events,
  stateWord,
}: {
  events: ObjectEvent[];
  /** A state's words, for this kind of object. */
  stateWord: (state: string | undefined) => string;
}) {
  return (
    <PageSection title={m.object_history()}>
      {events.length === 0 ? (
        <p className="text-body-sm text-fg-muted">{m.object_history_empty()}</p>
      ) : (
        <ol className="divide-y divide-line">
          {events.map((event) => {
            const created = event.type === 'object.created';
            const changed = event.type === 'object.state_changed';
            const what = created
              ? m.object_history_created()
              : changed
                ? m.object_history_state({
                    from: stateWord(event.data.from),
                    to: stateWord(event.data.to),
                  })
                : event.label;
            const whence =
              event.source === 'app'
                ? m.object_history_from_app({ app: event.app ?? '' })
                : m.object_history_from_kete();
            return (
              <li
                key={event.eventId}
                className="grid grid-cols-[4.5rem_10px_minmax(0,1fr)_auto] items-start gap-3 py-2.5 text-body-sm max-sm:grid-cols-[3.5rem_10px_minmax(0,1fr)]"
              >
                <time dateTime={event.occurredAt} className="tabular-nums text-fg-muted">
                  {when(event.occurredAt)}
                </time>
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2.5 rounded-full ${dot[event.source === 'app' ? 'app' : created ? 'created' : 'changed']}`}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <b className="font-semibold">{what}</b>
                  <small className="block text-caption text-fg-muted">{whence}</small>
                </span>
                <span className="max-sm:hidden">
                  <Tag tone={event.source === 'app' ? 'info' : 'neutral'}>
                    {event.source === 'app'
                      ? m.object_history_tag_event()
                      : m.object_history_tag_state()}
                  </Tag>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </PageSection>
  );
}
