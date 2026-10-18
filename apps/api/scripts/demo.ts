import { serve } from '@hono/node-server';
import { createTokenVerifier } from '@kete/auth';
import { inOrganization } from '@kete/tenancy';
import { createTestSchema, loadRepositoryEnv } from '@kete/testing';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { scriptedAnswers, scriptedEvening, scriptedProposal } from '../db/demo/answers.js';
import { useClosureModel } from '../src/features/closure/index.js';
import { seedDay } from '../db/demo/day.js';
import { seedErp } from '../db/demo/erp.js';
import { seedMoney, seedParties, seedProject } from '../db/demo/references.js';
import { seedTime } from '../db/demo/time.js';
import { demoEmail } from '../db/demo/kya.js';
import { seedLibrary } from '../db/demo/library.js';
import { seedThreads } from '../db/demo/threads.js';
import { seedDemo } from '../db/demo/seed.js';
import { migrations } from '../db/migrations.js';
import { useAgentModel } from '../src/features/agents/index.js';
import { useModel } from '../src/features/assistant/index.js';

// Kete Enterprise on this machine, to look at its screens: `pnpm demo` from the repository's root.
//
// Nothing here is a deployment. The data live in a throwaway schema of the *test* database (the
// repository's .env: KETE_TEST_OWNER_URL, KETE_TEST_APP_URL), seeded with the KYA demo profile and
// dropped when the script stops. There is no Compte Kete: the script signs tokens with a key of its
// own, which this API alone trusts, and a local « door » puts the session in the browser.
//
//   http://localhost:3501        enters as the organization's administrator
//   http://localhost:3501/as/…   enters viewing the space of a demo person (the script lists them)
//
// The screens are built first; `--fresh` reuses the build that is there.
//
// Joined to a Compte Kete running on this machine (`KETE_DEMO_JOINED=on`, set by kete-core's
// `pnpm platform`): this API also trusts that Compte Kete's tokens, the screens sign in through
// it (`KETE_ACCOUNT_URL`, `KETE_CLIENT_ID`, `KETE_CLIENT_SECRET`), the data are seeded in its
// organization (`KETE_DEMO_ORGANIZATION`), and its person (`KETE_DEMO_ME`) is the head of
// after-sales whose day is played. With `KETE_DEMO_MODEL=real`, the assistant answers with the
// configured model (`KETE_AI_*`) instead of answers written in advance.

const API_PORT = 3600;
const WEB_PORT = 3500;
const DOOR_PORT = 3501;
const joined = process.env.KETE_DEMO_JOINED === 'on';
const realModel = process.env.KETE_DEMO_MODEL === 'real';
const ORGANIZATION = (joined && process.env.KETE_DEMO_ORGANIZATION) || 'org_demo_kya';
const ME = joined ? (process.env.KETE_DEMO_ME ?? '') : '';
const joinedAccount = joined ? (process.env.KETE_ACCOUNT_URL ?? '') : '';
// Joined: on 127.0.0.1, the loopback address the Compte Kete accepts for a client's return.
const HOST = joined ? '127.0.0.1' : 'localhost';
const ADMINISTRATOR = { userId: 'usr_demo_admin', name: 'Administratrice (démo)' };
// Whose morning the demo plays, and who asks her for decisions (db/demo/kya.ts).
const MANAGER = 'Abla Nyuiadzi';
const COLLEAGUE = 'Délali Tchalla';
const DIRECTOR = 'Folly Ayité';
const issuer = 'https://compte.kete.demo';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const say = (line: string) => console.log(`[demo] ${line}`);

loadRepositoryEnv();
const sessionSecret = randomBytes(32).toString('hex');
Object.assign(process.env, {
  KETE_ACCOUNT_URL: joinedAccount || issuer,
  KETE_ENVIRONMENT: 'development',
  PUBLIC_API_URL: `http://${HOST}:${API_PORT}`,
  PUBLIC_WEB_URL: `http://${HOST}:${WEB_PORT}`,
  // No e-mail leaves, no worker runs: this is a look at the screens.
  KETE_MAIL_MODE: 'capture',
  KETE_WORKER_IN_PROCESS: 'false',
});

// The identity of this run: one key, known to this API only.
const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'demo-1', alg: 'EdDSA' };
const { usePool } = await import('../src/platform/db.js');
const { acceptedAudiences, useVerifier } = await import('../src/platform/identity.js');
const { createApi, permissionCatalog } = await import('../src/app.js');
const own = createTokenVerifier({ issuer, audience: acceptedAudiences(), jwks: { keys: [jwk] } });
// Joined: the Compte Kete on this machine signs people in; this run's key still seeds the data.
const account = joinedAccount
  ? createTokenVerifier({ issuer: joinedAccount, audience: acceptedAudiences() })
  : null;
useVerifier(account ? (token) => own(token).catch(() => account(token)) : own);

// A run that was killed could not drop its schema: the next one does.
const leftover = fileURLToPath(new URL('../.demo-schema', import.meta.url));
if (existsSync(leftover)) {
  const name = readFileSync(leftover, 'utf8').trim();
  if (/^t_[0-9a-f]{6,32}$/.test(name) && process.env.KETE_TEST_OWNER_URL) {
    const owner = new pg.Pool({ connectionString: process.env.KETE_TEST_OWNER_URL, max: 1 });
    await owner.query(`drop schema if exists ${name} cascade`).catch(() => undefined);
    await owner.end();
  }
  rmSync(leftover, { force: true });
}

if (!process.argv.includes('--fresh') || !existsSync(`${root}apps/web/dist/server/server.js`)) {
  say('Construction des écrans…');
  const built = spawnSync('pnpm --filter @kete-enterprise/web build', {
    cwd: root,
    shell: true,
    stdio: 'ignore',
    env: process.env,
  });
  if (built.status !== 0)
    throw new Error('The screens did not build: run `pnpm --filter @kete-enterprise/web build`.');
}

say('Création d’un schéma jetable dans la base de test…');
const db = await createTestSchema({
  migrate: async (owner, context) => {
    for (const migration of migrations) await owner.query(migration.sql(context));
  },
});
usePool(db.app);
writeFileSync(leftover, db.schema);
// Joined: this throwaway schema alone also holds the apps beside it on this machine's loopback.
if (joined) {
  await db.owner.query(
    `alter table ${db.schema}.resources drop constraint resources_address_check;
     alter table ${db.schema}.resources add constraint resources_address_check
       check (address like 'https://%' or address like 'http://127.0.0.1:%')`,
  );
}
say(`Schéma ${db.schema}. Données de démonstration (profil KYA)…`);
const report = await seedDemo({
  app: db.app,
  owner: db.owner,
  schema: db.schema,
  organizationId: ORGANIZATION,
  permissions: permissionCatalog,
});
say(`Semé : ${report.units} unités, ${report.positions} postes, ${report.people} personnes.`);

// Joined: the person signed in through the Compte Kete is the head of after-sales.
if (ME) {
  await inOrganization(db.app, ORGANIZATION, (client) =>
    client.query('update people set account_user_id = $1 where name = $2', [ME, MANAGER]),
  );
}
const people = await inOrganization(db.app, ORGANIZATION, (client) =>
  client.query<{ person_id: string; name: string; account_user_id: string }>(
    // Only a person with an account can be viewed as (spec 010).
    'select person_id, name, account_user_id from people where account_user_id is not null order by name',
  ),
);

/** A token as the Compte Kete would issue it, signed with this run's key. */
const tokenFor = (userId: string, name: string, role: 'owner' | 'member') =>
  new SignJWT({ email: `${userId}@example.test`, name, org: ORGANIZATION, role })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'demo-1' })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience('urn:kete:apps')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(pair.privateKey);
const token = await tokenFor(ADMINISTRATOR.userId, ADMINISTRATOR.name, 'owner');

// A day in it (step C2): the morning of the head of after-sales, played through the API.
const app = createApi();
// The center's references (step F1): the third parties, one of them written twice.
const partiesSeeded = await seedParties({ api: app, admin: token });
if (partiesSeeded > 0)
  say(`Tiers : ${partiesSeeded} fiches, dont un doublon à fusionner dans /tiers.`);
// A library with one report, indexed without a model (step C4).
if (await seedLibrary({ api: app, admin: token })) {
  say('Bibliothèque : un rapport SAV indexé ; cherchez « batteries » dans /bibliotheque.');
}
const manager = people.rows.find((person) => person.name === MANAGER);
const colleague = people.rows.find((person) => person.name === COLLEAGUE);
// Her own manager, who asks her for a quote (step C5).
const director = people.rows.find((person) => person.name === DIRECTOR);
if (manager && colleague) {
  // The center's project (step F2): the Garage Bè site, led by the head of after-sales.
  if (
    await seedProject({
      api: app,
      admin: token,
      lead: { userId: manager.account_user_id, name: manager.name },
    })
  ) {
    say('Projet : « Chantier Garage Bè », son client, son budget par poste, dans /projets.');
    const moneySaid = await seedMoney({ api: app, admin: token });
    if (moneySaid > 0) say(`Argent : ${moneySaid} mouvements écrits d’avance sur ce projet.`);
  }
  const day = await seedDay({
    api: app,
    organizationId: ORGANIZATION,
    admin: token,
    manager: {
      token: await tokenFor(manager.account_user_id, manager.name, 'member'),
      personId: manager.person_id,
    },
    colleague: { token: await tokenFor(colleague.account_user_id, colleague.name, 'member') },
    requester: {
      token: director
        ? await tokenFor(director.account_user_id, director.name, 'member')
        : await tokenFor(colleague.account_user_id, colleague.name, 'member'),
    },
    managerName: manager.name,
    lookup: db.owner,
  });
  say(
    `Journée de ${manager.name} : ${day.decisions} décisions, ${day.reminders} rappel, ` +
      `${day.agentTasksDone} tâche d’agent faite, ${day.agentTasksWaiting} en attente, ` +
      `${day.requests} demande d’un collègue à signer.`,
  );
  for (const what of day.skipped) say(`  non joué : ${what}`);
  // Her threads (spec 090): Garage Bè on WhatsApp, a colleague's ask, a mail « à classer ».
  const threads = await seedThreads({
    app: db.app,
    organizationId: ORGANIZATION,
    colleague: colleague.account_user_id,
  });
  say(
    `Fils : Garage Bè a écrit sur WhatsApp dans le fil du projet${threads.triage ? ', un mail attend « à classer » chez la direction' : ''} ; voir /fils.`,
  );
  // Her holdings, gathered from the six sources (spec 087): what « Pour moi » shows her.
  const pourMoi = (await (
    await app.request('/v1/pour-moi', {
      headers: {
        authorization: `Bearer ${await tokenFor(manager.account_user_id, manager.name, 'member')}`,
      },
    })
  ).json()) as { toAnswer: { source: { kind: string } }[]; held: { source: { kind: string } }[] };
  const kinds = [...new Set(pourMoi.held.map((h) => h.source.kind))].join(', ');
  say(
    `Pour moi de ${manager.name} : ${pourMoi.toAnswer.length} à répondre, ` +
      `${pourMoi.held.length} tenue(s) (${kinds}).`,
  );
  // The week in Planifier, as the apps would have said it (spec 079): the leave and the clash
  // fall on one of the director's reports, so that her « Mon équipe » shows them.
  if (director) {
    const card = await app.request('/v1/directory/me', {
      headers: {
        authorization: `Bearer ${await tokenFor(director.account_user_id, director.name, 'member')}`,
      },
    });
    const reports = card.ok
      ? ((await card.json()) as { reports: { userId: string | null }[] }).reports
      : [];
    const absent = reports.find((r) => r.userId && r.userId !== manager.account_user_id)?.userId;
    const timeSaid = await seedTime({
      api: app,
      admin: token,
      manager: manager.account_user_id,
      colleague: absent ?? manager.account_user_id,
    });
    if (timeSaid > 0) {
      say(
        `Planifier : ${timeSaid} faits datés cette semaine, dont un conflit — « Mon équipe » de ` +
          `${director.name} : http://localhost:${DOOR_PORT}/as/${director.person_id}`,
      );
    }
  }
  // No ERP here either: one is served in memory, its connector left on trial (step C9).
  if (await seedErp({ api: app, admin: token, approver: demoEmail(manager.name) })) {
    say(
      'Connecteur : un ERP écrit d’avance, à l’essai dans Administration › Connecteurs ' +
        '(Essayer, Connecter, Lire maintenant).',
    );
  }
  // No model here: the assistant's answers are written in advance, on the demo's own data.
  // « Créer un agent en une phrase » proposes the same job description, to show its dry run.
  if (!realModel) useAgentModel(scriptedProposal());
  // « Ce soir » (spec 083): gestures proposed on her To do, written in advance.
  if (!realModel) useClosureModel(scriptedEvening());
  if (realModel) {
    say(
      `Assistant : le vrai modèle (${process.env.KETE_AI_PROVIDER} ${process.env.KETE_AI_MODEL}).`,
    );
  } else if (day.datasetId) {
    useModel(scriptedAnswers(day.datasetId));
    say(
      'Assistant : réponses écrites d’avance (aucun modèle). Toute question rend le tableau ' +
        'des factures impayées, lu par son outil.',
    );
  }
}
/** The screens' own session, as their sign-in would have written it (@kete/auth). */
const sessionFor = async (userId: string, name: string, role: 'owner' | 'member') =>
  new SignJWT({
    email: `${userId}@example.test`,
    name,
    org: ORGANIZATION,
    role,
    apps: {},
    two_factor: true,
    at: await tokenFor(userId, name, role),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(new TextEncoder().encode(sessionSecret));
const session = await sessionFor(ADMINISTRATOR.userId, ADMINISTRATOR.name, 'owner');

const api = serve({ fetch: app.fetch, port: API_PORT, hostname: '127.0.0.1' });

// Joined: the apps beside the center (`KETE_DEMO_APPS`, their addresses) are registered in its
// registry as soon as each answers — their identity card read on this machine, which only this
// demo allows — in the name of the person signed in, so that the center takes their holdings, their
// facts and their gestures, and lends their tools to her assistant.
const joinedApps = joined ? (process.env.KETE_DEMO_APPS ?? '').split(',').filter(Boolean) : [];
if (ME && joinedApps.length > 0) {
  const { validateManifest } = await import('@kete/sdk');
  const { useCardReader } = await import('../src/features/registry/index.js');
  const cardAt = async (address: string) => {
    const answer = await fetch(new URL('/.well-known/kete', address)).catch(() => null);
    if (!answer?.ok) return null;
    const manifest: unknown = await answer.json().catch(() => null);
    return validateManifest(manifest).ok ? (manifest as { name: string }) : null;
  };
  useCardReader(async (address) => (await cardAt(address)) as never);
  const mine = await tokenFor(ME, MANAGER, 'owner');
  void (async () => {
    for (const address of joinedApps) {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const card = await cardAt(address);
        if (card) {
          const registered = await app.request('/v1/registry/resources', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${mine}`,
              'content-type': 'application/json',
              'idempotency-key': `demo-app-${address.replace(/[^a-zA-Z0-9]+/g, '-')}`,
            },
            body: JSON.stringify({ kind: 'app', name: card.name, address }),
          });
          say(
            `Registre : ${card.name} ${registered.ok ? 'inscrite' : `refusée (${registered.status} ${(await registered.text()).slice(0, 200)})`}.`,
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  })();
}

const web = spawn(
  `pnpm --filter @kete-enterprise/web exec srvx serve --entry dist/server/server.js --static "${root}apps/web/dist/client" --prod --host 127.0.0.1 --port ${WEB_PORT}`,
  {
    cwd: root,
    shell: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PUBLIC_URL: `http://${HOST}:${WEB_PORT}`,
      API_URL: `http://${HOST}:${API_PORT}`,
      // Joined: the screens sign in through the Compte Kete, with their registered client.
      KETE_CLIENT_ID: (joined && process.env.KETE_CLIENT_ID) || 'demo',
      KETE_CLIENT_SECRET: (joined && process.env.KETE_CLIENT_SECRET) || 'demo',
      SESSION_SECRET: sessionSecret,
    },
  },
);

// The door: cookies of « localhost » are shared by its ports, so the session set here is the
// screens' own. It only ever answers this machine.
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const door = createServer(async (request, response) => {
  const viewed = /^\/as\/(prs_[0-9a-f-]{8,64})$/.exec(request.url ?? '')?.[1];
  // « /comme/… »: signed in as the demo person herself, not viewed by the administrator.
  const herself = /^\/comme\/(prs_[0-9a-f-]{8,64})$/.exec(request.url ?? '')?.[1];
  const person = people.rows.find((row) => row.person_id === herself);
  const entering = person
    ? await sessionFor(person.account_user_id, person.name, 'member')
    : session;
  response.writeHead(302, {
    location: `http://localhost:${WEB_PORT}/`,
    'set-cookie': [
      cookie('kete_session', entering, 8 * 3600),
      viewed ? cookie('kete_view_as', viewed, 8 * 3600) : cookie('kete_view_as', '', 0),
    ],
  });
  response.end();
}).listen(DOOR_PORT, '127.0.0.1');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  say('Arrêt : le schéma de démonstration est supprimé.');
  door.close();
  api.close();
  if (web.pid) spawnSync(`taskkill /pid ${web.pid} /T /F`, { shell: true, stdio: 'ignore' });
  await db.drop().catch(() => undefined);
  rmSync(leftover, { force: true });
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

for (let attempt = 0; attempt < 90; attempt++) {
  const up = await fetch(`http://localhost:${WEB_PORT}/`, { redirect: 'manual' })
    .then((answer) => answer.status < 500)
    .catch(() => false);
  if (up) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
say(
  joined
    ? `Ouvrez http://127.0.0.1:${WEB_PORT} et connectez-vous avec votre Compte Kete : vous êtes ${MANAGER}.`
    : `Ouvrez http://localhost:${DOOR_PORT} (administratrice de la démonstration).`,
);
if (manager) {
  say(`Le matin de ${manager.name} : http://localhost:${DOOR_PORT}/comme/${manager.person_id}`);
}
for (const person of people.rows.filter((row) => row !== manager).slice(0, 8)) {
  say(`  comme ${person.name} : http://localhost:${DOOR_PORT}/as/${person.person_id}`);
}
say('Ctrl C pour arrêter.');
