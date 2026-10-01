import { assertOrganizationIsolation, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { useCardReader } from '../src/features/registry/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 008: one library of controls serves every framework; evidence comes from the company's own
// records or a person's attestation, with its fingerprint; documents, audits, findings, corrective
// actions and certificates follow the four-eyes rule; the controls watch signals what is wrong.

let db: TestSchema;
const api = createApi();
const t: Record<string, string> = {};
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(
  token: string | undefined,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
) {
  const response = await api.request(`/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token ?? ''}`,
      'content-type': 'application/json',
      'idempotency-key': `compliance-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string | undefined, path: string, body: object = {}) =>
  call(token, 'POST', path, body);
const id = async (token: string | undefined, path: string, body: object, field: string) => {
  const answer = await post(token, path, body);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return String(answer.body[field]);
};

interface Overview {
  frameworks: {
    code: string;
    requirements: { reference: string; controls: { name: string; status: string }[] }[];
  }[];
  controls: {
    controlId: string;
    status: string;
    evidence: { contentHash: string; outcome: string } | null;
  }[];
  documents: { documentId: string; versions: { version: number; status: string }[] }[];
  findings: { findingId: string; status: string }[];
}
const overview = async (token = t.admin) =>
  (await call(token, 'GET', '/compliance')).body as unknown as Overview;
const statusOf = async (controlId: string | undefined) =>
  (await overview()).controls.find((c) => c.controlId === controlId)?.status;
const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await startApi();
  useCardReader(async () => null);
  t.admin = await tokenFor('usr_ama', { role: 'admin' });
  t.bea = await tokenFor('usr_bea', { role: 'admin' });
  for (const who of ['esi', 'kofi'])
    t[who] = await tokenFor(`usr_${who}`, { role: 'member', name: who });
  const type = await id(
    t.admin,
    '/structure/unit-types',
    { key: 'unit', name: 'Unité' },
    'unitTypeId',
  );
  ids.group = await id(
    t.admin,
    '/structure/units',
    { unitTypeId: type, name: 'KYA Group', startsOn: '2026-01-01' },
    'unitId',
  );
  ids.quality = await id(
    t.admin,
    '/structure/positions',
    { unitId: ids.group, title: 'Responsable qualité', startsOn: '2026-01-01' },
    'positionId',
  );
  const esi = await id(
    t.admin,
    '/structure/people',
    { name: 'Esi', accountUserId: 'usr_esi' },
    'personId',
  );
  await post(t.admin, '/structure/assignments', {
    personId: esi,
    positionId: ids.quality,
    kind: 'primary',
    startsOn: '2026-01-01',
  });
  const reader = await id(
    t.admin,
    '/rights/roles',
    { name: 'Conformité', permissions: ['compliance:read'] },
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId: reader,
    positionId: ids.quality,
    startsOn: '2026-01-01',
  });
  // An app without an identity card: what the automatic control will find.
  await post(t.kofi, '/registry/resources', {
    kind: 'app',
    name: 'Caisse',
    address: 'https://caisse.example.test',
  });
});
afterAll(async () => {
  await db.drop();
});

describe('frameworks and shared controls', () => {
  it('serves two frameworks with one control', async () => {
    ids.iso = await id(
      t.admin,
      '/compliance/frameworks',
      { code: 'iso9001', name: 'ISO 9001', edition: '2015', kind: 'standard' },
      'frameworkId',
    );
    ids.policy = await id(
      t.admin,
      '/compliance/frameworks',
      { code: 'policy-it', name: 'Politique informatique', kind: 'policy' },
      'frameworkId',
    );
    const isoReq = await id(
      t.admin,
      '/compliance/requirements',
      {
        frameworkId: ids.iso,
        reference: '7.1.6',
        summary: 'Les savoirs dont dépendent les processus sont tenus à jour.',
      },
      'requirementId',
    );
    const policyReq = await id(
      t.admin,
      '/compliance/requirements',
      {
        frameworkId: ids.policy,
        reference: 'P-3',
        summary: 'Chaque application a un responsable.',
      },
      'requirementId',
    );
    ids.apps = await id(
      t.admin,
      '/compliance/controls',
      {
        name: 'Chaque app a sa fiche et son responsable',
        description: 'Lu dans le registre.',
        frequencyDays: 30,
        method: 'automatic',
        check: 'registry.apps_have_card',
        requirementIds: [isoReq, policyReq],
      },
      'controlId',
    );
    const view = await overview();
    for (const code of ['iso9001', 'policy-it']) {
      const framework = view.frameworks.find((f) => f.code === code);
      expect(framework?.requirements[0]?.controls).toEqual([
        {
          controlId: ids.apps,
          name: 'Chaque app a sa fiche et son responsable',
          status: 'missing',
        },
      ]);
    }
  });

  it('refuses an unknown check, and a member without rights', async () => {
    const unknown = await post(t.admin, '/compliance/controls', {
      name: 'X',
      description: 'X',
      frequencyDays: 1,
      method: 'automatic',
      check: 'treasury.balanced',
    });
    expect(unknown).toMatchObject({ status: 409, body: { error: 'unknown_check' } });
    expect((await call(t.kofi, 'GET', '/compliance')).status).toBe(403);
    expect(
      (await post(t.kofi, '/compliance/frameworks', { code: 'x', name: 'X', kind: 'policy' }))
        .status,
    ).toBe(403);
  });
});

describe('evidence', () => {
  it("collects an automatic control from the company's records, with its fingerprint", async () => {
    const collected = await post(t.admin, `/compliance/controls/${ids.apps}/collect`);
    expect(collected.status).toBe(201);
    expect(collected.body).toMatchObject({
      outcome: 'fail',
      details: { count: 1, items: ['Caisse'] },
    });
    expect(String(collected.body.contentHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(await statusOf(ids.apps)).toBe('failing');
  });

  it('takes an attestation from the holder of the owner position', async () => {
    ids.review = await id(
      t.admin,
      '/compliance/controls',
      {
        name: 'Revue de direction tenue',
        description: 'La direction revoit le système chaque trimestre.',
        ownerPositionId: ids.quality,
        frequencyDays: 90,
        method: 'attestation',
      },
      'controlId',
    );
    expect(
      (
        await post(t.kofi, `/compliance/controls/${ids.review}/attest`, {
          outcome: 'pass',
          summary: 'X',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await post(t.esi, `/compliance/controls/${ids.review}/attest`, {
          outcome: 'pass',
          summary: 'Revue du 30 septembre, compte rendu signé.',
        })
      ).status,
    ).toBe(201);
    expect(await statusOf(ids.review)).toBe('passing');
    expect(
      await post(t.admin, `/compliance/controls/${ids.apps}/attest`, {
        outcome: 'pass',
        summary: 'X',
      }),
    ).toMatchObject({ status: 409, body: { error: 'not_attested' } });
    expect(await post(t.admin, `/compliance/controls/${ids.review}/collect`)).toMatchObject({
      status: 409,
      body: { error: 'not_automatic' },
    });
  });

  it('keeps evidence as it was, and says when it is too old', async () => {
    await expect(db.app.query(`update evidence set outcome = 'pass'`)).rejects.toThrow(
      /permission denied/,
    );
    await db.owner.query(
      `update evidence set valid_until = current_date - 1 where control_id = $1`,
      [ids.review],
    );
    expect(await statusOf(ids.review)).toBe('expired');
  });
});

describe('documents, audits, findings, certificates', () => {
  it('approves a version by someone other than its author', async () => {
    const written = await post(t.admin, '/compliance/documents', {
      title: 'Politique qualité',
      kind: 'policy',
      content: 'Version 1',
    });
    ids.doc = String(written.body.documentId);
    expect(
      await post(t.admin, `/compliance/documents/${ids.doc}/approve`, { version: 1 }),
    ).toMatchObject({ status: 409, body: { error: 'own_writing' } });
    expect(
      (await post(t.bea, `/compliance/documents/${ids.doc}/approve`, { version: 1 })).status,
    ).toBe(201);
    await post(t.admin, '/compliance/documents', {
      documentId: ids.doc,
      title: 'Politique qualité',
      kind: 'policy',
      content: 'Version 2',
    });
    expect(
      (await post(t.bea, `/compliance/documents/${ids.doc}/approve`, { version: 2 })).status,
    ).toBe(201);
    const doc = (await overview()).documents.find((d) => d.documentId === ids.doc);
    expect(doc?.versions.map((v) => v.status)).toEqual(['obsolete', 'approved']);
  });

  it('closes a finding once its corrective actions are done and verified by someone else', async () => {
    const audit = await id(
      t.admin,
      '/compliance/audits',
      { frameworkId: ids.iso, kind: 'internal', plannedOn: '2026-09-15' },
      'auditId',
    );
    expect(
      (
        await post(t.admin, `/compliance/audits/${audit}/conclude`, {
          conclusion: 'Une non-conformité mineure.',
        })
      ).status,
    ).toBe(201);
    const finding = await id(
      t.admin,
      '/compliance/findings',
      {
        auditId: audit,
        controlId: ids.apps,
        severity: 'minor',
        description: 'Une app sans fiche.',
      },
      'findingId',
    );
    const action = await id(
      t.admin,
      '/compliance/actions',
      {
        findingId: finding,
        description: 'Publier la fiche de la Caisse',
        ownerUserId: 'usr_kofi',
        dueOn: '2026-01-31',
      },
      'actionId',
    );
    expect(await post(t.esi, `/compliance/actions/${action}/complete`)).toMatchObject({
      status: 409,
      body: { error: 'not_owner' },
    });
    expect(await post(t.admin, `/compliance/actions/${action}/verify`)).toMatchObject({
      status: 409,
      body: { error: 'not_done' },
    });
    expect((await post(t.kofi, `/compliance/actions/${action}/complete`)).status).toBe(201);
    expect((await post(t.admin, `/compliance/actions/${action}/verify`)).body).toMatchObject({
      findingClosed: true,
    });
    expect((await overview()).findings.find((f) => f.findingId === finding)?.status).toBe('closed');
    // Its owner never verifies her own action.
    const own = await id(
      t.admin,
      '/compliance/actions',
      { findingId: finding, description: 'Former', ownerUserId: 'usr_ama', dueOn: inDays(10) },
      'actionId',
    );
    await post(t.admin, `/compliance/actions/${own}/complete`);
    expect(await post(t.admin, `/compliance/actions/${own}/verify`)).toMatchObject({
      status: 409,
      body: { error: 'own_action' },
    });
  });

  it('records a certificate with its dates', async () => {
    expect(
      (
        await post(t.admin, '/compliance/certificates', {
          frameworkId: ids.iso,
          body: 'Organisme accrédité',
          number: 'Q-2026-17',
          issuedOn: '2024-01-01',
          expiresOn: inDays(30),
        })
      ).status,
    ).toBe(201);
    const late = await post(t.admin, '/compliance/certificates', {
      frameworkId: ids.iso,
      body: 'X',
      number: 'X',
      issuedOn: '2026-01-01',
      expiresOn: '2025-01-01',
    });
    expect(late).toMatchObject({ status: 422 });
  });
});

describe('the controls watch', () => {
  it('signals failing and expired controls, overdue actions and expiring certificates', async () => {
    await post(t.admin, '/compliance/actions', {
      findingId: (await overview()).findings[0]?.findingId,
      description: 'En retard',
      ownerUserId: 'usr_kofi',
      dueOn: '2026-01-01',
    });
    const agent = await post(t.esi, '/agents', {
      name: 'Veille des contrôles',
      kind: 'personal',
      mission: 'Signaler ce qui ne va pas dans la conformité.',
      permissions: ['compliance:read'],
      watches: ['compliance'],
    });
    expect(agent.status).toBe(201);
    expect((await post(t.esi, `/agents/${agent.body.agentId}/wake`)).body).toMatchObject({
      acted: true,
      raised: 4,
    });
    const agents = (await call(t.esi, 'GET', '/agents')).body as unknown as {
      agents: { signals: { kind: string }[] }[];
    };
    expect(agents.agents[0]?.signals.map((s) => s.kind).sort()).toEqual([
      'compliance.action_overdue',
      'compliance.certificate_expiring',
      'compliance.control_expired',
      'compliance.control_failing',
    ]);
  });

  it("keeps each organization's frameworks and evidence to itself", async () => {
    for (const table of ['frameworks', 'evidence']) {
      await assertOrganizationIsolation({
        app: db.app,
        table,
        organizations: ['org_iso_a', 'org_iso_b'],
        insert: async (client, organization) => {
          const suffix = `${organization.slice(-1)}${table.length}`;
          await client.query(
            `insert into frameworks (framework_id, organization_id, code, name, kind) values ($1, $2, $3, 'Iso', 'policy')`,
            [`fwk_iso${suffix}`, organization, `iso${suffix}`],
          );
          if (table === 'frameworks') return;
          await client.query(
            `insert into controls (control_id, organization_id, name, description, frequency_days, method)
             values ($1, $2, 'Iso', 'Iso', 30, 'attestation')`,
            [`ctl_iso${suffix}`, organization],
          );
          await client.query(
            `insert into evidence (evidence_id, organization_id, control_id, source, outcome, summary,
               content_hash, collected_by, valid_until)
             values ($1, $2, $3, 'attestation', 'pass', 'Iso', 'h', 'usr_iso', current_date)`,
            [`evd_iso${suffix}`, organization, `ctl_iso${suffix}`],
          );
        },
      });
    }
  });
});
