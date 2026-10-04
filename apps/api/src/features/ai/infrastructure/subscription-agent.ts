import { randomUUID } from 'node:crypto';
import { boatProvider, type Sandbox, type SandboxProvider } from '@kete/sandbox';
import { SubscriptionLostError, type SubscriptionAgent } from '../subscriptions.js';

// A person's subscription answers through Codex, signed in with her ChatGPT account on her own
// sandbox (spec 026b). The agent's and the provider's names stay here, in the infrastructure. The
// sandbox gets nothing of Kete's account (no environment, no secret): only her own sign-in, and
// each prompt she sends.

const LOGIN_LOG = '.kete-login.log';
/** The terminal's colors and moves (ESC [ … letter), removed: only the words remain. */
const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');
const strip = (text: string) => text.replace(ESCAPES, '');

/** The model her subscription answers with (`KETE_SUBSCRIPTION_MODEL`, default gpt-6.1-sol). */
const model = () => process.env.KETE_SUBSCRIPTION_MODEL?.trim() || 'gpt-6.1-sol';

let provider: SandboxProvider | null | undefined;
function sandboxes(): SandboxProvider | null {
  if (provider === undefined) {
    const apiKey = process.env.KETE_SANDBOX_API_KEY?.trim();
    provider = apiKey ? boatProvider({ apiKey }) : null;
  }
  return provider;
}

async function machine(id: string): Promise<Sandbox> {
  const box = await sandboxes()?.open(id);
  if (!box) throw new SubscriptionLostError('Her machine no longer exists.');
  return box;
}

const extension: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const codexAgent: SubscriptionAgent = {
  available: () => sandboxes() !== null,

  async startSignIn(machineId) {
    const machines = sandboxes();
    if (!machines) throw new Error('This instance runs no machine.');
    const box =
      (machineId ? await machines.open(machineId) : null) ??
      (await machines.create({ size: 'small', ttlSeconds: 1800 }));
    // A sign-in left half-way is stopped first; `[c]odex` never matches this command itself.
    await box.run(`pkill -f '[c]odex login' ; rm -f ${LOGIN_LOG}`, { timeoutSeconds: 30 });
    await box.run(`nohup codex login --device-auth > ${LOGIN_LOG} 2>&1 &`, { timeoutSeconds: 30 });
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const log = strip((await box.run(`cat ${LOGIN_LOG}`, { timeoutSeconds: 30 })).stdout);
      const url = /https:\/\/\S+/.exec(log)?.[0];
      const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/.exec(log)?.[0];
      if (url && code) return { machineId: box.id, url, code };
    }
    throw new Error('The sign-in did not start.');
  },

  async signedIn(machineId) {
    const box = await sandboxes()?.open(machineId);
    if (!box) return null;
    const status = await box.run('codex login status', { timeoutSeconds: 30 });
    return status.exitCode === 0;
  },

  async answer(machineId, input) {
    const box = await machine(machineId);
    const dir = `kete/${randomUUID()}`;
    await box.writeFile(`${dir}/prompt.md`, input.prompt);
    const images: string[] = [];
    for (const [index, image] of input.images.entries()) {
      const name = `image-${index}.${extension[image.mediaType] ?? 'png'}`;
      await box.writeFile(`${dir}/${name}`, image.data);
      images.push(name);
    }
    // Read-only: whatever a file asks, the agent writes nothing and reaches no network for its
    // own commands. The prompt comes on standard input; the answer is its last message.
    const result = await box.run(
      [
        `cd ${dir} &&`,
        'codex exec --skip-git-repo-check --ephemeral -s read-only',
        `-m '${model().replace(/'/g, '')}'`,
        ...images.map((name) => `-i ${name}`),
        '-o answer.md - < prompt.md',
      ].join(' '),
      { timeoutSeconds: 300 },
    );
    try {
      if (result.exitCode !== 0) {
        const why = strip(`${result.stderr}\n${result.stdout}`);
        if (/not logged in|401|unauthorized|log in again|sign in again/i.test(why)) {
          throw new SubscriptionLostError('Her subscription is signed out.');
        }
        throw new Error(`The agent failed: ${why.slice(-400)}`);
      }
      return new TextDecoder().decode(await box.readFile(`${dir}/answer.md`)).trim();
    } finally {
      await box.run(`rm -rf ${dir}`, { timeoutSeconds: 30 }).catch(() => undefined);
    }
  },

  async rest(machineId) {
    const box = await sandboxes()?.open(machineId, { resume: false });
    await box?.stop();
  },

  async forget(machineId) {
    // Deleted as it is: a stopped machine is not woken up first.
    const box = await sandboxes()?.open(machineId, { resume: false });
    await box?.destroy();
  },
};

let agent: SubscriptionAgent = codexAgent;

export function subscriptionAgent(): SubscriptionAgent {
  return agent;
}

/** Tests: another agent (none runs for real). */
export function useSubscriptionAgent(next: SubscriptionAgent | undefined): void {
  agent = next ?? codexAgent;
}
