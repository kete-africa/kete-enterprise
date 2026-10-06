import { createJobs, defineJob, type Jobs } from '@kete/jobs';
import { dueAgents, runQueuedTasks, wakeDueAgents } from './features/agents/index.js';
import { runDueSchedules } from './features/assistant/index.js';
import { sendQueuedMail } from './features/mail/index.js';
import {
  checkDueWatches,
  listenForRoutines,
  runQueuedRoutines,
} from './features/routines/index.js';
import { getPool } from './platform/db.js';
import { env } from './platform/env.js';

/**
 * The worker (doctrine D-029, pg-boss): every five minutes, it wakes the agents due. Agents sleep
 * between rounds (D-039): permanent does not mean in a loop.
 */
export async function startWorker(): Promise<Jobs> {
  // The scheduled tasks' runs are kept in the routines' history (spec 051).
  listenForRoutines();
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
    ],
    work: true,
  });
  await jobs.start();
  console.log('Kete Enterprise worker started');
  return jobs;
}
