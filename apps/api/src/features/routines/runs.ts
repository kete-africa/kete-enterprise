import type { SqlExecutor } from '@kete/tenancy';
import { getPool, transaction } from '../../platform/db.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { appsHeardBy, eventOf, onAppEvent, type AcceptedEvent } from '../apps/index.js';
import { answerAndLand, onScheduleRun } from '../assistant/index.js';
import { readFigure } from '../dashboards/index.js';
import { notificationWords, tell } from '../notifications/index.js';
import {
  claimRun,
  finishRun,
  markWatch,
  recordRun,
  triggerFor,
  triggersListening,
  watchFor,
  type Person,
  type RunStatus,
  type Watch,
} from './routines.js';

// Running routines (spec 051): an app's event queues a run for each trigger listening, whose
// person still hears that app; the worker runs them, and checks the watches due, each with the
// person's rights — never an administrator's.

type Identity = IdentityVariables['identity'];

/** Who a routine runs for: her, as her token would say — without any administrator's role. */
export const identityOf = (p: Person): Identity => ({
  userId: p.userId,
  email: p.email,
  name: p.name,
  organizationId: p.organizationId,
  role: null,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 15 * 60_000),
});

const summaryOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 300) || null;

/** The facts an event brings to her instruction: its type, its words, its data unless secret. */
function factsOf(event: AcceptedEvent | null): string {
  if (!event) return 'Essai : aucun évènement réel, réponds comme si l’évènement venait d’arriver.';
  const data =
    event.classification === 'secret'
      ? '(données secrètes, non transmises)'
      : JSON.stringify(event.data).slice(0, 4000);
  return `Évènement « ${event.type} » (${event.description}), le ${event.occurredAt} : ${data}`;
}

/** Each accepted event queues one run per trigger listening, in the event's own transaction. */
export async function queueEventRuns(db: SqlExecutor, event: AcceptedEvent): Promise<number> {
  if (event.classification === 'secret') return 0;
  let queued = 0;
  for (const trigger of await triggersListening(db, event.resourceId, event.type)) {
    // She hears this app still: her registry shows it, her rights in it give her something.
    const heard = await appsHeardBy(db, { userId: trigger.person.userId, role: null });
    const app = heard.find((a) => a.resourceId === event.resourceId);
    if (!app?.emits.some((e) => e.type === event.type)) continue;
    await recordRun(db, {
      organizationId: trigger.person.organizationId,
      userId: trigger.person.userId,
      family: 'event',
      routineId: trigger.triggerId,
      title: trigger.title,
      cause: `${app.name} · ${event.description}`,
      status: 'queued',
      eventId: event.eventId,
    });
    queued += 1;
  }
  return queued;
}

/** Runs one trigger: her instruction answered with the event's facts, landed in « À faire ». */
async function answerTrigger(
  organizationId: string,
  triggerId: string,
  eventId: string | null,
): Promise<{ status: RunStatus; summary: string | null; href: string | null }> {
  const found = await transaction(organizationId, async (db) => ({
    trigger: await triggerFor(db, triggerId),
    event: eventId ? await eventOf(db, eventId) : null,
  }));
  if (!found.trigger) return { status: 'failed', summary: null, href: null };
  const t = found.trigger;
  const answer = await answerAndLand(
    {
      ...t.person,
      title: t.title,
      prompt: `${t.prompt}\n\n${factsOf(found.event)}`,
    },
    `${t.triggerId}-${eventId ?? 'essai'}`,
  );
  return {
    status: answer.status,
    summary: summaryOf(answer.text),
    href: answer.conversationId ? `/assistant?c=${answer.conversationId}` : null,
  };
}

/** The worker's round of triggered runs: each taken once, one failure never stopping the rest. */
export async function runQueuedRoutines(): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string; run_id: string }>(
    'select organization_id, run_id from routine_runs_queued()',
  );
  let ran = 0;
  for (const { organization_id: organizationId, run_id: runId } of rows) {
    try {
      const run = await transaction(organizationId, (db) => claimRun(db, runId));
      if (!run) continue;
      const outcome = await answerTrigger(organizationId, run.routineId, run.eventId);
      await transaction(organizationId, (db) => finishRun(db, runId, outcome));
      ran += 1;
    } catch (error) {
      console.error(`routine run ${runId} failed`, error);
      await transaction(organizationId, (db) =>
        finishRun(db, runId, { status: 'failed', summary: null, href: null }),
      ).catch(() => undefined);
    }
  }
  return ran;
}

/** « Essayer maintenant » on a trigger of hers: run at once, without a real event. */
export async function tryTrigger(identity: Identity, triggerId: string): Promise<RunStatus | null> {
  const trigger = await transaction(identity.organizationId, (db) =>
    triggerFor(db, triggerId, identity.userId),
  );
  if (!trigger) return null;
  const outcome = await answerTrigger(identity.organizationId, triggerId, null);
  await transaction(identity.organizationId, (db) =>
    recordRun(db, {
      organizationId: identity.organizationId,
      userId: identity.userId,
      family: 'event',
      routineId: triggerId,
      title: trigger.title,
      cause: 'essai',
      tried: true,
      ...outcome,
    }),
  );
  return outcome.status;
}

const beyond = (w: Pick<Watch, 'direction' | 'line'>, value: number) =>
  w.direction === 'above' ? value > w.line : value < w.line;

/**
 * Checks one watch with its person's rights: crossing its line tells her once, and again only
 * after the figure came back. A tried check is kept in her history whatever it found.
 */
export async function checkWatch(
  organizationId: string,
  watchId: string,
  options: { tried: boolean; userId?: string },
): Promise<RunStatus | null> {
  return transaction(organizationId, async (db) => {
    const w = await watchFor(db, watchId, options.userId);
    if (!w) return null;
    const figure = await readFigure(db, identityOf(w.person), w.dashboardId, w.cardId);
    const crossed = figure !== null && beyond(w, figure.value);
    const tells = crossed && (!w.crossed || options.tried);
    await markWatch(db, w.watchId, { value: figure?.value ?? null, crossed });
    const format = new Intl.NumberFormat(w.person.locale, { maximumFractionDigits: 2 });
    const said = figure
      ? notificationWords(w.person.locale).routineCrossed(
          figure.title,
          format.format(figure.value),
          format.format(w.line),
          w.direction === 'above',
        )
      : null;
    const href = `/tableaux-de-bord/${w.dashboardId}`;
    if (tells && said) {
      await tell(db, organizationId, w.person.userId, { kind: 'routine.watch', title: said, href });
    }
    const status: RunStatus = figure === null ? 'failed' : tells ? 'told' : 'quiet';
    if (tells || options.tried) {
      await recordRun(db, {
        organizationId,
        userId: w.person.userId,
        family: 'watch',
        routineId: w.watchId,
        title: w.title,
        cause: options.tried ? 'essai' : 'veille',
        status,
        summary: said ?? (figure ? format.format(figure.value) : null),
        href,
        tried: options.tried,
      });
    }
    return status;
  });
}

/** The worker's round of watches due: at most once an hour each. */
export async function checkDueWatches(): Promise<number> {
  const { rows } = await getPool().query<{ organization_id: string; watch_id: string }>(
    'select organization_id, watch_id from routine_watches_due()',
  );
  let checked = 0;
  for (const { organization_id: organizationId, watch_id: watchId } of rows) {
    try {
      await checkWatch(organizationId, watchId, { tried: false });
      checked += 1;
    } catch (error) {
      console.error(`watch ${watchId} could not be checked`, error);
    }
  }
  return checked;
}

let listening = false;
/** Routines hear the apps' events and keep the scheduled tasks' runs in their history. */
export function listenForRoutines(): void {
  if (listening) return;
  listening = true;
  onAppEvent(async (db, event) => {
    await queueEventRuns(db, event);
  });
  onScheduleRun(async ({ schedule, status, conversationId, text, tried }) => {
    await transaction(schedule.organizationId, (db) =>
      recordRun(db, {
        organizationId: schedule.organizationId,
        userId: schedule.userId,
        family: 'time',
        routineId: schedule.scheduleId,
        title: schedule.title,
        cause: tried ? 'essai' : 'heure fixe',
        status,
        summary: summaryOf(text),
        href: conversationId ? `/assistant?c=${conversationId}` : null,
        tried,
      }),
    );
  });
}
