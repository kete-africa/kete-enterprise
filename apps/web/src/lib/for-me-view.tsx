import { Button, CanvasIcon, PageSection, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { handBackHolding, receivedOf, settleTriage, type ForMe, type Holding } from '@/lib/for-me';
import { readAllNotifications, type NotificationItem } from '@/lib/notifications';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// « Pour moi » beyond the decisions' pile (doctrine D-057, spec 090): what she must answer, the
// cards « à classer » the router left her, what she holds, what she is told — each with how long
// it has waited and the way back to its source.

/** The sources the pile above already shows, one decision at a time. */
const inThePile = new Set([
  'enterprise:app_task',
  'enterprise:action',
  'enterprise:circuit_step',
  'enterprise:draft',
  'enterprise:request',
]);
const sourceOf = (h: Holding) => `${h.source.app}:${h.source.kind}`;

/** How long, in her words: « 35 min », « 2 h », « 3 j ». */
export function ageOf(iso: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return m.for_me_minutes({ count: String(minutes) });
  if (minutes < 60 * 24) return m.for_me_hours({ count: String(Math.round(minutes / 60)) });
  return m.for_me_days({ count: String(Math.round(minutes / 1440)) });
}

/** A due day in her words: « jeu. 16 oct. ». */
const dueDay = (day: string) =>
  new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${day.slice(0, 10)}T12:00:00`),
  );

const iconOf = (h: Holding) =>
  h.source.app === 'threads'
    ? 'chat'
    : h.source.kind === 'request'
      ? 'people'
      : h.source.kind === 'agent_task'
        ? 'bot'
        : 'inbox';

function HoldingLine({ holding, canHandBack }: { holding: Holding; canHandBack: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waited = holding.waitingSince ?? holding.since;
  const late = Date.now() - new Date(waited).getTime() > 48 * 3_600_000;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3">
      <span className="inline-flex size-8 items-center justify-center rounded-full bg-surface-selected text-fg-muted">
        <CanvasIcon name={iconOf(holding)} size={16} />
      </span>
      <a href={holding.href} className="min-w-0 font-semibold text-fg hover:underline">
        {holding.what}
      </a>
      <span
        className={`font-mono text-body-sm whitespace-nowrap ${late ? 'text-state-error-fg' : 'text-state-verify-fg'}`}
      >
        {holding.due ? m.for_me_due({ day: dueDay(holding.due) }) : ageOf(waited)}
      </span>
      <span className="col-start-2 col-end-4 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
        {holding.waitingOn && (
          <span>
            {holding.waitingOn.kind === 'party' ? m.for_me_waits_party() : m.for_me_waits_someone()}
          </span>
        )}
        {holding.takenOverFrom && <Tag tone="info">{m.for_me_taken_over()}</Tag>}
        {canHandBack && holding.takenOverFrom && (
          <button
            type="button"
            disabled={busy}
            className="font-semibold text-link underline underline-offset-4"
            onClick={() => {
              setBusy(true);
              setError(null);
              void handBackHolding({
                data: { holdingId: holding.holdingId, reason: m.for_me_hand_back_reason() },
              })
                .then(async (answer) => {
                  if (!answer.ok) return setError(refusal(answer.error));
                  await router.invalidate();
                })
                .finally(() => setBusy(false));
            }}
          >
            {m.for_me_hand_back()}
          </button>
        )}
        {error && <span className="text-state-error-fg">{error}</span>}
      </span>
    </li>
  );
}

function Lines({ holdings, canHandBack }: { holdings: Holding[]; canHandBack: boolean }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-box border border-line bg-surface">
      {holdings.map((h) => (
        <HoldingLine key={h.holdingId} holding={h} canHandBack={canHandBack} />
      ))}
    </ul>
  );
}

export interface PlaceChoices {
  projects: { id: string; name: string }[];
  parties: { id: string; name: string }[];
}

const intents = [
  'client_message',
  'incident',
  'quote_request',
  'invoice_request',
  'other',
] as const;
const intentWord = (intent: (typeof intents)[number]) =>
  ({
    client_message: m.triage_intent_message(),
    incident: m.triage_intent_incident(),
    quote_request: m.triage_intent_quote(),
    invoice_request: m.triage_intent_invoice(),
    other: m.triage_intent_other(),
  })[intent];

/** A card « à classer »: what was received, and where she places it — learned for next time. */
function TriageCard({
  holding,
  places,
  readOnly,
}: {
  holding: Holding;
  places: PlaceChoices;
  readOnly: boolean;
}) {
  const router = useRouter();
  const received = receivedOf(holding);
  const [target, setTarget] = useState('');
  const [intent, setIntent] = useState<(typeof intents)[number]>('client_message');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = holding.holdingId;
  return (
    <article className="grid gap-3 rounded-box border border-dashed border-line-strong bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {received && (
          <Tag>
            {received.via === 'mail'
              ? m.triage_via_mail()
              : received.via === 'form'
                ? m.triage_via_form()
                : m.triage_via_chat()}
          </Tag>
        )}
        <span className="font-semibold">{holding.what}</span>
        <span className="ml-auto font-mono text-body-sm text-fg-muted">{ageOf(holding.since)}</span>
      </div>
      <p className="text-body-sm text-fg-muted">{m.triage_why()}</p>
      {!readOnly && received && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const [kind, objectId] = target.split(':');
            if (!kind || !objectId) return setError(m.triage_choose());
            setBusy(true);
            setError(null);
            void settleTriage({
              data: { via: received.via, ref: received.ref, kind, id: objectId, intent },
            })
              .then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                await router.invalidate();
              })
              .finally(() => setBusy(false));
          }}
        >
          <label className="grid gap-1 text-body-sm" htmlFor={`triage-target-${id}`}>
            {m.triage_where()}
            <select
              id={`triage-target-${id}`}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-(--control-height) min-w-56 rounded-control border border-line-control bg-control px-2"
            >
              <option value="">{m.triage_choose()}</option>
              {places.projects.length > 0 && (
                <optgroup label={m.nav_projects()}>
                  {places.projects.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {places.parties.length > 0 && (
                <optgroup label={m.nav_parties()}>
                  {places.parties.map((p) => (
                    <option key={p.id} value={`party:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="grid gap-1 text-body-sm" htmlFor={`triage-intent-${id}`}>
            {m.triage_what()}
            <select
              id={`triage-intent-${id}`}
              value={intent}
              onChange={(event) => setIntent(event.target.value as (typeof intents)[number])}
              className="h-(--control-height) rounded-control border border-line-control bg-control px-2"
            >
              {intents.map((i) => (
                <option key={i} value={i}>
                  {intentWord(i)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={busy}>
            {m.triage_place()}
          </Button>
          {error && (
            <p role="alert" className="basis-full text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </form>
      )}
      <p className="text-body-sm text-fg-muted">{m.triage_learned()}</p>
    </article>
  );
}

/** What she was told (spec 030), the unread first; read all in one gesture. */
function Told({ items, readOnly }: { items: NotificationItem[]; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const shown = [...items].sort((a, b) => Number(a.read) - Number(b.read)).slice(0, 12);
  return (
    <div className="border-t border-line">
      <ul className="divide-y divide-line">
        {shown.map((n) => (
          <li key={n.notificationId} className="grid gap-0.5 px-4 py-2.5">
            <span className="flex flex-wrap items-baseline gap-2">
              {!n.read && <span className="size-2 rounded-full bg-action" aria-hidden="true" />}
              {n.href ? (
                <a
                  href={n.href}
                  className={`hover:underline ${n.read ? 'text-fg-soft' : 'font-semibold text-fg'}`}
                >
                  {n.title}
                </a>
              ) : (
                <span className={n.read ? 'text-fg-soft' : 'font-semibold'}>{n.title}</span>
              )}
              <span className="ml-auto font-mono text-body-sm text-fg-muted">
                {ageOf(n.createdAt)}
              </span>
            </span>
            {n.body && <span className="text-body-sm text-fg-muted">{n.body}</span>}
          </li>
        ))}
      </ul>
      {!readOnly && items.some((n) => !n.read) && (
        <p className="border-t border-line px-4 py-2.5">
          <button
            type="button"
            disabled={busy}
            className="text-body-sm font-semibold text-link"
            onClick={() => {
              setBusy(true);
              void readAllNotifications()
                .then(() => router.invalidate())
                .finally(() => setBusy(false));
            }}
          >
            {m.for_me_read_all()}
          </button>
        </p>
      )}
    </div>
  );
}

/** The sections of « Pour moi » after the pile: answer, place, hold, be told. */
export function ForMeSections({
  forMe,
  places,
  readOnly,
  told = [],
}: {
  forMe: ForMe;
  places: PlaceChoices;
  readOnly: boolean;
  /** Her notifications (spec 030): « Pour moi » replaces the bell (D-057). */
  told?: NotificationItem[];
}) {
  const unread = told.filter((n) => !n.read).length;
  const triage = forMe.held.filter((h) => receivedOf(h));
  const held = forMe.held.filter((h) => !receivedOf(h) && !inThePile.has(sourceOf(h)));
  return (
    <>
      {forMe.toAnswer.length > 0 && (
        <PageSection title={m.for_me_answer({ count: String(forMe.toAnswer.length) })}>
          <Lines holdings={forMe.toAnswer} canHandBack={false} />
        </PageSection>
      )}
      {triage.length > 0 && (
        <PageSection title={m.for_me_triage({ count: String(triage.length) })}>
          <div className="grid gap-3">
            {triage.map((h) => (
              <TriageCard key={h.holdingId} holding={h} places={places} readOnly={readOnly} />
            ))}
          </div>
        </PageSection>
      )}
      <PageSection title={m.for_me_held({ count: String(held.length) })}>
        {held.length === 0 ? (
          <p className="text-fg-muted">{m.for_me_held_none()}</p>
        ) : (
          <Lines holdings={held} canHandBack={!readOnly} />
        )}
      </PageSection>
      {(forMe.information.length > 0 || told.length > 0) && (
        <PageSection
          title={m.for_me_information({ count: String(unread + forMe.information.length) })}
        >
          <details open={unread > 0} className="rounded-box border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 font-semibold">
              {m.for_me_information_open()}
            </summary>
            {told.length > 0 && <Told items={told} readOnly={readOnly} />}
            {forMe.information.length > 0 && (
              <Lines holdings={forMe.information} canHandBack={false} />
            )}
          </details>
        </PageSection>
      )}
    </>
  );
}
