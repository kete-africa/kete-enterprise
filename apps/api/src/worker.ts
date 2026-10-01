import { createJobs, defineJob, type Jobs } from '@kete/jobs';
import { dueAgents, wakeDueAgents } from './features/agents/index.js';
import { getPool } from './platform/db.js';
import { env } from './platform/env.js';

/**
 * The worker (doctrine D-029, pg-boss): every five minutes, it wakes the agents due. Agents sleep
 * between rounds (D-039): permanent does not mean in a loop.
 */
export async function startWorker(): Promise<Jobs> {
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
    ],
    work: true,
  });
  await jobs.start();
  console.log('Kete Enterprise worker started');
  return jobs;
}
