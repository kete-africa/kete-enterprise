import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright';

// The screens beside the canvas (spec 099; « build from the validated mockup »): starts the demo,
// walks the threads, her thread « Kete » (case A said for real), a group's orders (case B), her
// agents and the mails' settings, on a computer and a phone, light and dark — and shoots the same
// screens of the canvas v6.2, to be read side by side. Nothing here is asserted: a person looks.
//
//   pnpm --filter @kete-enterprise/web build   # the demo serves the built screens
//   pnpm --filter @kete-enterprise/web screens # then read apps/web/.screens/

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = fileURLToPath(new URL('../.screens/', import.meta.url));
const canvas = pathToFileURL(
  fileURLToPath(new URL('../../../../kete-core/docs/brief-ui/canevas-v6.2.html', import.meta.url)),
).href;
mkdirSync(out, { recursive: true });

const WEB = 'http://localhost:3500';
const DOOR = 'http://localhost:3501';
const devices = {
  computer: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
} as const;
const themes = ['light', 'dark'] as const;

/** The demo, started fresh; resolves with Abla's door once it says it. */
function startDemo(): Promise<{ abla: string; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const demo = spawn('pnpm', ['demo', '--fresh'], { cwd: root, shell: true });
    const timer = setTimeout(
      () => reject(new Error('The demo did not start in 5 minutes.')),
      300_000,
    );
    let said = '';
    const read = (chunk: Buffer) => {
      said += chunk.toString();
      const door = /Le matin de [^:]+: (http:\/\/localhost:3501\/comme\/\S+)/.exec(said);
      if (door?.[1] && said.includes('Ctrl C pour arrêter')) {
        clearTimeout(timer);
        resolve({
          abla: door[1],
          stop: () => {
            if (process.platform !== 'win32') return void demo.kill('SIGTERM');
            // On Windows its servers outlive the shell: whoever listens on its two ports stops.
            spawnSync('taskkill', ['/pid', String(demo.pid), '/t', '/f']);
            spawnSync('powershell', [
              '-NoProfile',
              '-Command',
              'Get-NetTCPConnection -LocalPort 3500,3501 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }',
            ]);
          },
        });
      }
    };
    demo.stdout.on('data', read);
    demo.stderr.on('data', read);
    demo.on('exit', (code) => reject(new Error(`The demo stopped (${code ?? 'signal'}).`)));
  });
}

async function shoot(page: Page, name: string, theme?: 'light' | 'dark') {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Her theme is her preference: shown here as if she had chosen this one.
  if (theme) await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(`[screens] ${name}`);
}

/**
 * The thread's own field — the drawer's stays hidden — filled and sent once the page is alive (a
 * field filled before React took the page over is emptied by it); said when it did not show.
 */
async function say(page: Page, name: string, text: string, mention?: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1000);
  const field = page.locator('textarea[placeholder]:visible').last();
  await field.click();
  await field.pressSequentially(text, { delay: 8 });
  if (mention) {
    await field.pressSequentially(` @${mention.slice(0, 3)}`, { delay: 60 });
    const option = page.getByRole('option').filter({ hasText: mention }).first();
    await option
      .click({ timeout: 5000 })
      .catch(() => console.log(`[screens] ${name}: no « @${mention} »`));
    await field.pressSequentially(' prépare le planning de novembre pour vendredi.', { delay: 8 });
  }
  await page.keyboard.press('Enter');
  // Sent is shown in the thread, not only an emptied field.
  const shown = await page
    .getByText(text.slice(0, 30))
    .last()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    await page.screenshot({ path: `${out}${name}-not-sent.png` });
    console.log(`[screens] ${name}: not sent`);
  }
}

async function walk(
  context: BrowserContext,
  admin: BrowserContext,
  prefix: string,
  theme: 'light' | 'dark',
  first: boolean,
) {
  const page = await context.newPage();
  await page.goto(`${WEB}/fils`);
  await shoot(page, `${prefix}-fils`, theme);
  // The project's thread, where the client wrote and where case B is said.
  await page.goto(`${WEB}/fils?liste=1`);
  // Its thread in the list — the sidebar's link of the same name opens the project's page.
  const project = await page
    .locator('a[href*="fil=thr_"]')
    .filter({ hasText: 'Chantier Garage Bè' })
    .first()
    .getAttribute('href');
  await page.goto(`${WEB}${project ?? '/fils'}`);
  await page.locator('textarea[placeholder]:visible').last().waitFor({ timeout: 15000 });
  if (first) {
    // Case B: a group's orders, read unasked; Kete answers its author alone.
    await say(
      page,
      `${prefix}-cas-b`,
      'À partir de lundi, tout achat au-delà de 50 000 F passe par moi.',
      'Délali',
    );
    await page.waitForTimeout(10000);
    await page.reload();
  }
  await page
    .locator('[aria-label="Chantier Garage Bè"] .overflow-auto, main .overflow-auto')
    .last()
    .evaluate((el) => el.scrollTo(0, el.scrollHeight))
    .catch(() => undefined);
  await shoot(page, `${prefix}-cas-b`, theme);
  await page.goto(`${WEB}/assistant`);
  if (first) {
    // Case A: what she says coming out of a client's, understood and attached.
    await say(
      page,
      `${prefix}-kete`,
      'Je sors de chez M. Agbeko. Il veut deux prises de plus dans la salle 3, et il paie le solde vendredi.',
    );
    await page.waitForTimeout(9000);
    await page.reload();
  }
  await shoot(page, `${prefix}-kete`, theme);
  await page.goto(`${WEB}/mes-agents`);
  await shoot(page, `${prefix}-agents`, theme);
  const mails = await admin.newPage();
  await mails.goto(`${WEB}/administration/boites-mail`);
  await shoot(mails, `${prefix}-mails`, theme);
  await mails.close();
  await page.close();
}

/** The canvas's screens, opened by its own buttons; dark by its own toggle. */
async function canvasScreens(
  context: BrowserContext,
  prefix: string,
  dark: boolean,
  phone: boolean,
) {
  const page = await context.newPage();
  await page.goto(canvas);
  if (dark)
    await page
      .locator('#toggle-theme')
      .click()
      .catch(() => undefined);
  const screens = phone ? ['telephone6'] : ['fil6', 'casB', 'kete6', 'casA', 'agents6', 'mails6'];
  for (const screen of screens) {
    await page
      .locator(`[data-go="${screen}"]`)
      .last()
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(500);
    await shoot(page, `${prefix}-${screen}`);
  }
  await page.close();
}

const demo = await startDemo();
const browser = await chromium.launch();
try {
  let first = true;
  for (const [device, options] of Object.entries(devices)) {
    for (const theme of themes) {
      const prefix = `${device}-${theme}`;
      const context = await browser.newContext({ ...options, colorScheme: theme });
      const admin = await browser.newContext({ ...options, colorScheme: theme });
      await (await context.newPage()).goto(demo.abla);
      await (await admin.newPage()).goto(DOOR);
      await walk(context, admin, prefix, theme, first);
      first = false;
      const sketch = await browser.newContext({ ...options, colorScheme: theme });
      await canvasScreens(sketch, `canevas-${prefix}`, theme === 'dark', device === 'phone');
      await Promise.all([context.close(), admin.close(), sketch.close()]);
    }
  }
} finally {
  await browser.close();
  demo.stop();
}
console.log(`[screens] in ${out}`);
