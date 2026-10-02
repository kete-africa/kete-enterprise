import { memorySender } from '@kete/notify';
import { inOrganization } from '@kete/tenancy';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import {
  queueMail,
  renderMail,
  sendQueuedMail,
  useEmailSender,
} from '../src/features/mail/index.js';
import { issuePass, resolvePass, revokePasses } from '../src/features/passes/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 010: people find themselves by e-mail, people without an account open a personal link,
// e-mails leave with their gesture (or land in the test outbox), modules switch per organization,
// and « view as » exists only in a demo organization.

let db: TestSchema;
const api = createApi();
const t = { admin: '', awa: '', twin: '', other: '' };
let key = 0;

type Answer = Record<string, unknown>;
async function call(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': `foundation-key-${++key}`,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) => call(token, 'POST', path, body);
const get = (token: string, path: string, headers: Record<string, string> = {}) =>
  call(token, 'GET', path, undefined, headers);

const people: Record<string, string> = {};
let position = '';

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  t.awa = await tokenFor('usr_awa');
  t.twin = await tokenFor('usr_twin');
  t.other = await tokenFor('usr_other', { org: 'org_other', role: 'admin' });
  const type = (await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' })).body
    .unitTypeId as string;
  const unit = (await post(t.admin, '/structure/units', { unitTypeId: type, name: 'Siège' })).body
    .unitId as string;
  position = (await post(t.admin, '/structure/positions', { unitId: unit, title: 'Technicien' }))
    .body.positionId as string;
});

afterAll(async () => {
  await db?.drop();
});

describe('people find themselves', () => {
  it('links an account to the one person who carries its e-mail', async () => {
    people.awa = (
      await post(t.admin, '/structure/people', { name: 'Awa', email: 'USR_AWA@example.test' })
    ).body.personId as string;
    const me = (await get(t.awa, '/me')).body;
    expect(me.personId).toBe(people.awa);
    // Once linked, it stays the same.
    expect((await get(t.awa, '/me')).body.personId).toBe(people.awa);
  });

  it('links nobody when two people share the e-mail', async () => {
    await post(t.admin, '/structure/people', { name: 'Twin A', email: 'usr_twin@example.test' });
    await post(t.admin, '/structure/people', { name: 'Twin B', email: 'usr_twin@example.test' });
    expect((await get(t.twin, '/me')).body.personId).toBeNull();
  });

  it('lets an administrator correct, unlink and link a person', async () => {
    const corrected = await post(t.admin, `/structure/people/${people.awa}`, {
      name: 'Awa K.',
      phone: '+22890000000',
    });
    expect(corrected.status).toBe(201);
    expect(corrected.body).toMatchObject({ name: 'Awa K.', email: 'USR_AWA@example.test' });
    await post(t.admin, `/structure/people/${people.awa}/account`, { accountUserId: null });
    const other = (await post(t.admin, '/structure/people', { name: 'Someone' })).body
      .personId as string;
    expect(
      (await post(t.admin, `/structure/people/${other}/account`, { accountUserId: 'usr_awa' }))
        .status,
    ).toBe(201);
    expect((await get(t.awa, '/me')).body.personId).toBe(other);
    // A member does not decide who acts as whom.
    expect(
      (await post(t.awa, `/structure/people/${other}/account`, { accountUserId: null })).status,
    ).toBe(403);
  });

  it('imports people, each row on its own', async () => {
    const report = await post(t.admin, '/structure/people/import', {
      rows: [
        { name: 'Kossi', email: 'kossi@kya-demo.test', positionId: position },
        { name: 'Ama', email: 'not-an-email' },
        { name: 'Yao', email: 'kossi@kya-demo.test' },
        { name: 'Efua', positionId: 'pos_00000000' },
        { name: 'Edem', phone: '+228 90 11 22 33' },
      ],
    });
    expect(report.status).toBe(201);
    expect(report.body).toEqual({
      created: 2,
      refused: [
        { row: 2, code: 'invalid_row' },
        { row: 3, code: 'duplicate_email' },
        { row: 4, code: 'not_found' },
      ],
    });
    const chart = (await get(t.admin, '/structure')).body as {
      people: { name: string; personId: string }[];
      assignments: { personId: string; positionId: string }[];
    };
    const kossi = chart.people.find((p) => p.name === 'Kossi');
    expect(chart.assignments.some((a) => a.personId === kossi?.personId)).toBe(true);
  });
});

describe('a personal link', () => {
  it('opens its purpose only, and dies when revoked or replaced', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const first = await inOrganization(db.app, 'org_kya', (tx) =>
      issuePass(tx, 'org_kya', {
        personId: people.awa ?? '',
        purpose: 'surveys.answer',
        reference: 'cmp_1',
        expiresAt,
      }),
    );
    expect(first.url).toMatch(/\/lien\/[A-Za-z0-9_-]{43}$/);
    expect(await resolvePass(first.token)).toMatchObject({
      organizationId: 'org_kya',
      personId: people.awa,
      purpose: 'surveys.answer',
    });
    const answer = await api.request(`/public/passes/${first.token}`);
    expect(await answer.json()).toEqual({
      purpose: 'surveys.answer',
      reference: 'cmp_1',
      person: { name: 'Awa K.' },
    });
    // The table keeps a fingerprint, never the link.
    const stored = await db.owner.query(`select fingerprint from ${db.schema}.person_passes`);
    expect(JSON.stringify(stored.rows)).not.toContain(first.token);

    const second = await inOrganization(db.app, 'org_kya', (tx) =>
      issuePass(tx, 'org_kya', {
        personId: people.awa ?? '',
        purpose: 'surveys.answer',
        reference: 'cmp_1',
        expiresAt,
      }),
    );
    expect(await resolvePass(first.token)).toBeNull();
    expect(await resolvePass(second.token)).not.toBeNull();
    await inOrganization(db.app, 'org_kya', (tx) => revokePasses(tx, 'surveys.answer', ['cmp_1']));
    expect(await resolvePass(second.token)).toBeNull();
    expect((await api.request('/public/passes/not-a-token')).status).toBe(404);
  });

  it('expires', async () => {
    const pass = await inOrganization(db.app, 'org_kya', (tx) =>
      issuePass(tx, 'org_kya', {
        personId: people.awa ?? '',
        purpose: 'surveys.answer',
        reference: 'cmp_2',
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    expect(await resolvePass(pass.token)).toBeNull();
  });
});

describe('e-mails', () => {
  const content = renderMail({
    locale: 'fr',
    sender: 'KYA-Energy Group',
    greeting: 'Bonjour Awa,',
    paragraphs: ['Votre avis compte <vraiment>.'],
    action: { label: 'Répondre', url: 'https://enterprise.kete.test/lien/abc' },
    reason: 'Vous recevez ce message pour l’enquête du trimestre.',
  });

  it('escapes what it shows, and says the same in text', () => {
    expect(content.html).toContain('&lt;vraiment&gt;');
    expect(content.text).toContain('Répondre : https://enterprise.kete.test/lien/abc');
  });

  it('lands in the test outbox in capture mode, for administrators only', async () => {
    await inOrganization(db.app, 'org_kya', (tx) =>
      queueMail(tx, 'org_kya', {
        to: 'awa@kya-demo.test',
        subject: 'Enquête T3',
        ...content,
        purpose: 'surveys.answer',
      }),
    );
    const outbox = (await get(t.admin, '/mail/outbox')).body as {
      mode: string;
      messages: { messageId: string; subject: string }[];
    };
    expect(outbox.mode).toBe('capture');
    expect(outbox.messages.map((m) => m.subject)).toEqual(['Enquête T3']);
    const read = (await get(t.admin, `/mail/outbox/${outbox.messages[0]?.messageId}`)).body;
    expect(read.html).toContain('Répondre');
    expect((await get(t.awa, '/mail/outbox')).status).toBe(403);
    // Another organization sees none of it.
    const elsewhere = (await get(t.other, '/mail/outbox')).body as { messages: unknown[] };
    expect(elsewhere.messages).toEqual([]);
  });

  it('leaves through the provider in send mode, and loses its content', async () => {
    const sender = memorySender();
    useEmailSender(sender);
    await db.owner.query(
      `insert into ${db.schema}.mail_messages (message_id, organization_id, recipient, subject,
         html, body_text, purpose, status)
       values ('mail_queued01', 'org_kya', 'awa@kya-demo.test', 'Revue T3', '<p>x</p>', 'x',
         'performance.review', 'queued')`,
    );
    expect(await sendQueuedMail()).toBe(1);
    expect(sender.sent.map((m) => m.subject)).toEqual(['Revue T3']);
    const { rows } = await db.owner.query(
      `select status, html from ${db.schema}.mail_messages where message_id = 'mail_queued01'`,
    );
    expect(rows[0]).toEqual({ status: 'sent', html: '' });
  });
});

describe('modules', () => {
  it('switch per organization, by administrators', async () => {
    expect((await get(t.admin, '/me')).body.modules).toMatchObject({
      compliance: true,
      surveys: false,
    });
    expect(
      (await post(t.awa, '/organization/modules', { module: 'surveys', enabled: true })).status,
    ).toBe(403);
    await post(t.admin, '/organization/modules', { module: 'compliance', enabled: false });
    expect((await get(t.admin, '/compliance')).body.error).toBe('module_disabled');
    // Another organization keeps its own.
    expect((await get(t.other, '/me')).body.modules).toMatchObject({ compliance: true });
    await post(t.admin, '/organization/modules', { module: 'compliance', enabled: true });
    expect((await get(t.admin, '/compliance')).status).toBe(200);
  });
});

describe('view as', () => {
  it('exists only in a demo organization, with the person’s rights', async () => {
    const demoPerson = (
      await post(t.admin, '/structure/people', { name: 'Persona', accountUserId: 'demo_persona' })
    ).body.personId as string;
    const asPersona = { 'kete-view-as': demoPerson };
    expect((await get(t.admin, '/me', asPersona)).body.error).toBe('view_as_forbidden');
    await db.owner.query(
      `insert into ${db.schema}.organization_settings (organization_id, demo) values ('org_kya', true)`,
    );
    const me = (await get(t.admin, '/me', asPersona)).body;
    expect(me).toMatchObject({
      userId: 'demo_persona',
      name: 'Persona',
      administrator: false,
      viewedBy: 'usr_admin',
      demo: true,
    });
    // Seen as the persona, the frame is out of reach.
    expect(
      (
        await call(
          t.admin,
          'POST',
          '/organization/modules',
          { module: 'surveys', enabled: true },
          asPersona,
        )
      ).status,
    ).toBe(403);
    // A member never views as anyone.
    expect((await get(t.awa, '/me', asPersona)).status).toBe(403);
    // The application never marks an organization as a demo.
    await expect(
      inOrganization(db.app, 'org_kya', (tx) =>
        tx.query(`update organization_settings set demo = false`),
      ),
    ).rejects.toThrow();
  });
});
