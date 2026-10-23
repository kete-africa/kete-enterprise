import { deliverPhones } from './features/phone/index.js';
import { createJobs, defineJob, type Jobs } from '@kete/jobs';
import { dueAgents, runQueuedTasks, wakeDueAgents } from './features/agents/index.js';
import { runDueSchedules } from './features/assistant/index.js';
import { readConnected } from './features/connectors/index.js';
import { dispatchPending, listenForEvents } from './features/events/index.js';
import { watchIndicators } from './features/measure/index.js';
import { sendQueuedMail } from './features/mail/index.js';
import {
  checkDueWatches,
  listenForRoutines,
  runQueuedRoutines,
} from './features/routines/index.js';
import { relayRound, syncHoldings, workOrganizations } from './features/work/index.js';
import {
  readMailboxes,
  ringUnread,
  runDueRoutines,
  sendDigests,
} from './features/messages/index.js';
import { getPool, transaction } from './platform/db.js';
import { env } from './platform/env.js';

/**
 * The worker (doctrine D-029, pg-boss): every five minutes, it wakes the agents due. Agents sleep
 * between rounds (D-039): permanent does not mean in a loop.
 */
export async function startWorker(): Promise<Jobs> {
  // The scheduled tasks' runs are kept in the routines' history (spec 051).
  listenForRoutines();
  // The event path (spec 101): each event dispatched as it is recorded; the minute catches up.
  void listenForEvents({ dispatch: true });
  const jobs = createJobs({
    // The jobs' own schema belongs to the owner role; an agent's work goes through the app's pool,
    // under row-level security.
    connectionString: env.ownerDatabaseUrl,
    jobs: [
      defineJob({
        name: 'wake-agents',
        schedule: '*/5 * * * *',
        retryLimit: 0,
        async handle() {
          const reports = await wakeDueAgents(() => dueAgents(getPool()));
          if (reports.length > 0) console.log(`[worker] ${reports.length} agent(s) woken`);
        },
      }),
      // Tasks given to agents (spec 036): run every minute, one after the other.
      defineJob({
        name: 'run-agent-tasks',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const ran = await runQueuedTasks();
          if (ran > 0) console.log(`[worker] ${ran} agent task(s) run`);
        },
      }),
      // People's scheduled tasks (spec 029): the morning briefings, the questions at a set time.
      defineJob({
        name: 'run-schedules',
        schedule: '*/5 * * * *',
        retryLimit: 0,
        async handle() {
          const ran = await runDueSchedules();
          if (ran > 0) console.log(`[worker] ${ran} scheduled task(s) run`);
        },
      }),
      // Routines an app's event triggered (spec 051): run every minute, one after the other.
      defineJob({
        name: 'run-routines',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const ran = await runQueuedRoutines();
          if (ran > 0) console.log(`[worker] ${ran} routine run(s)`);
        },
      }),
      // Watches on figures (spec 051): each at most once an hour.
      defineJob({
        name: 'check-watches',
        schedule: '*/5 * * * *',
        retryLimit: 0,
        async handle() {
          const checked = await checkDueWatches();
          if (checked > 0) console.log(`[worker] ${checked} watch(es) checked`);
        },
      }),
      // Connectors (spec 069): what waits in the organization's own tools, read every five minutes.
      defineJob({
        name: 'read-connectors',
        schedule: '*/5 * * * *',
        retryLimit: 0,
        async handle() {
          const read = await readConnected(getPool(), transaction);
          if (read > 0) console.log(`[worker] ${read} connector(s) read`);
        },
      }),
      // Messages to phones leave every minute (spec 077).
      defineJob({
        name: 'send-phones',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const sent = await deliverPhones();
          if (sent > 0) console.log(`[worker] ${sent} message(s) to phones`);
        },
      }),
      // The mailboxes the center reads (spec 089): each mail routed into its object's thread.
      defineJob({
        name: 'read-mailboxes',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const routed = await readMailboxes();
          if (routed > 0) console.log(`[worker] ${routed} mail(s) routed`);
        },
      }),
      // E-mails queued by gestures leave every minute; in capture mode none is ever queued.
      defineJob({
        name: 'send-mail',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const sent = await sendQueuedMail();
          if (sent > 0) console.log(`[worker] ${sent} e-mail(s) sent`);
        },
      }),
      // Agents whose routine is due set to work (spec 099, FR-015).
      defineJob({
        name: 'agent-routines',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const ran = await runDueRoutines();
          if (ran > 0) console.log(`[worker] ${ran} agent routine(s)`);
        },
      }),
      // A message still unread three minutes after it rings her phone, once (spec 099).
      defineJob({
        name: 'ring-threads',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const rung = await ringUnread();
          if (rung > 0) console.log(`[worker] ${rung} phone(s) rung for threads`);
        },
      }),
      // The threads' summary by mail, once a day after 18 h, for who chose it (spec 098).
      defineJob({
        name: 'threads-digest',
        schedule: '10 * * * *',
        retryLimit: 0,
        async handle() {
          const sent = await sendDigests();
          if (sent > 0) console.log(`[worker] ${sent} threads summary(ies) queued`);
        },
      }),
      // Events not yet delivered (spec 101): a safety net under the listener, every minute.
      defineJob({
        name: 'dispatch-events',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          const made = await dispatchPending();
          if (made > 0) console.log(`[worker] ${made} event delivery(ies)`);
        },
      }),
      // The Measure (spec 102): the center's indicators read for the organization; red obliges.
      defineJob({
        name: 'watch-indicators',
        schedule: '*/15 * * * *',
        retryLimit: 0,
        async handle() {
          const turned = await watchIndicators();
          if (turned > 0) console.log(`[worker] ${turned} indicator(s) turned red`);
        },
      }),
      // Holdings (spec 087): the six sources said as holdings each minute.
      defineJob({
        name: 'sync-holdings',
        schedule: '* * * * *',
        retryLimit: 0,
        async handle() {
          for (const organizationId of await workOrganizations(getPool())) {
            await transaction(organizationId, (db) => syncHoldings(db, organizationId)).catch(
              (error: unknown) => console.error(`[worker] holdings of ${organizationId}`, error),
            );
          }
        },
      }),
      // The relay (spec 087): each hour, who is away, who left, what waits too long.
      defineJob({
        name: 'relay-holdings',
        schedule: '5 * * * *',
        retryLimit: 0,
        async handle() {
          for (const organizationId of await workOrganizations(getPool())) {
            const report = await transaction(organizationId, (db) =>
              relayRound(db, organizationId),
            ).catch((error: unknown) => {
              console.error(`[worker] relay of ${organizationId}`, error);
              return null;
            });
            if (report && report.moved + report.nudged + report.stuck > 0) {
              console.log(`[worker] relay ${organizationId}: ${JSON.stringify(report)}`);
            }
          }
        },
      }),
    ],
    work: true,
  });
  await jobs.start();
  console.log('Kete Enterprise worker started');
  return jobs;
}
