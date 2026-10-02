import type { TestSchema } from '@kete/testing';
import { inOrganization } from '@kete/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { surveyScores } from '../src/features/surveys/index.js';
import { startApi, tokenFor } from './support.js';

// Spec 011: questionnaires, campaigns drawn from the structure, answers by personal link or by
// account, anonymity kept at submission, results on 100 with a minimum group, scores for spec 012.

let db: TestSchema;
const api = createApi();
const t = { admin: '', hr: '', awa: '', member: '' };
const ids: Record<string, string> = {};
let key = 0;

type Answer = Record<string, unknown>;
async function call(token: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api.request(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      'idempotency-key': `surveys-key-${++key}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: (await response.json()) as Answer };
}
const post = (token: string, path: string, body: object = {}) =>
  call(token, 'POST', `/v1${path}`, body);
const get = (token: string, path: string) => call(token, 'GET', `/v1${path}`);
const id = (answer: { body: Answer }, field: string) => String(answer.body[field] ?? '');

/** The personal links the test outbox holds for a recipient, newest first. */
async function linksOf(recipient: string): Promise<string[]> {
  const { rows } = await db.owner.query<{ html: string }>(
    `select html from ${db.schema}.mail_messages where recipient = $1 order by created_at desc`,
    [recipient],
  );
  return rows.flatMap((r) =>
    [...r.html.matchAll(/\/lien\/([A-Za-z0-9_-]{43})"/g)].map((m) => m[1] ?? ''),
  );
}

const content = {
  sections: [
    {
      key: 'it',
      title: 'Informatique',
      unitId: '',
      questions: [
        { key: 'it_net', type: 'rating', label: 'Connexion internet' },
        { key: 'it_help', type: 'rating', label: 'Réactivité', allowNa: true },
        { key: 'it_idea', type: 'text', label: 'Suggestions', required: false },
      ],
    },
    {
      key: 'hr',
      title: 'Ressources humaines',
      questions: [{ key: 'hr_leave', type: 'rating', label: 'Congés' }],
    },
  ],
};

beforeAll(async () => {
  db = await startApi();
  t.admin = await tokenFor('usr_admin', { role: 'admin' });
  t.hr = await tokenFor('usr_hr');
  t.awa = await tokenFor('usr_awa');
  t.member = await tokenFor('usr_member');
  await post(t.admin, '/organization/modules', { module: 'surveys', enabled: true });
  const type = id(
    await post(t.admin, '/structure/unit-types', { key: 'unit', name: 'Unité' }),
    'unitTypeId',
  );
  ids.top = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'KYA',
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  ids.it = id(
    await post(t.admin, '/structure/units', {
      unitTypeId: type,
      name: 'IT',
      parentId: ids.top,
      startsOn: '2026-01-01',
    }),
    'unitId',
  );
  const position = async (unitId: string, title: string, reportsTo?: string) =>
    id(
      await post(t.admin, '/structure/positions', {
        unitId,
        title,
        startsOn: '2026-01-01',
        ...(reportsTo ? { reportsTo } : {}),
      }),
      'positionId',
    );
  ids.dg = await position(ids.top ?? '', 'DG');
  ids.hrPos = await position(ids.top ?? '', 'DRH', ids.dg);
  ids.head = await position(ids.it ?? '', 'Chef IT', ids.dg);
  ids.team = await position(ids.it ?? '', "Chef d'équipe", ids.head);
  ids.tech1 = await position(ids.it ?? '', 'Technicien', ids.team);
  ids.tech2 = await position(ids.it ?? '', 'Technicien', ids.team);
  const person = async (name: string, positionId: string, extra: object) => {
    const personId = id(await post(t.admin, '/structure/people', { name, ...extra }), 'personId');
    await post(t.admin, '/structure/assignments', {
      personId,
      positionId,
      kind: 'primary',
      startsOn: '2026-01-01',
    });
    return personId;
  };
  ids.yaw = await person('Yaw', ids.dg ?? '', { email: 'yaw@kya-demo.test' });
  ids.esi = await person('Esi', ids.hrPos ?? '', {
    email: 'usr_hr@example.test',
    accountUserId: 'usr_hr',
  });
  ids.kofi = await person('Kofi', ids.head ?? '', { email: 'kofi@kya-demo.test' });
  // The team leader's position stays vacant: the technicians' manager is the head, above.
  ids.awa = await person('Awa', ids.tech1 ?? '', {
    email: 'usr_awa@example.test',
    accountUserId: 'usr_awa',
  });
  ids.yao = await person('Yao', ids.tech2 ?? '', {});
  const role = id(
    await post(t.admin, '/rights/roles', { name: 'RH', permissions: ['surveys:manage'] }),
    'roleId',
  );
  await post(t.admin, '/rights/grants', {
    roleId: role,
    positionId: ids.hrPos,
    startsOn: '2026-01-01',
  });
  content.sections[0] = {
    ...content.sections[0],
    unitId: ids.it ?? '',
  } as (typeof content.sections)[0];
});

afterAll(async () => {
  await db?.drop();
});

describe('questionnaires', () => {
  it('are written by HR, and copied once a campaign used them', async () => {
    expect(
      (await post(t.member, '/surveys/questionnaires', { title: 'X', anonymous: true, content }))
        .status,
    ).toBe(403);
    const saved = await post(t.hr, '/surveys/questionnaires', {
      title: 'Satisfaction des services',
      anonymous: true,
      content,
    });
    expect(saved.status).toBe(201);
    ids.questionnaire = id(saved, 'questionnaireId');
    const twoKeys = await post(t.hr, '/surveys/questionnaires', {
      title: 'Bad',
      anonymous: true,
      content: { sections: [content.sections[1], content.sections[1]] },
    });
    expect(twoKeys.status).toBe(422);
  });
});

describe('a campaign about the services', () => {
  it('opens to everyone, each by a personal link', async () => {
    ids.campaign = id(
      await post(t.hr, '/surveys/campaigns', {
        questionnaireId: ids.questionnaire,
        title: 'Satisfaction T3',
        period: 'T3 2026',
        opensOn: '2026-10-01',
        closesOn: '2026-10-15',
        audience: { kind: 'everyone' },
        minGroup: 3,
      }),
      'campaignId',
    );
    const opened = await post(t.hr, `/surveys/campaigns/${ids.campaign}/open`);
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({ respondents: 5, forms: 5, sent: 4, relayed: 1 });
    // Yao has no e-mail: his link went to the person who opened the campaign.
    const relay = await db.owner.query(
      `select subject from ${db.schema}.mail_messages where recipient = 'usr_hr@example.test'`,
    );
    expect(relay.rows.map((r) => r.subject).join(' ')).toContain('Yao');
    // The questionnaire is now frozen.
    expect(
      (
        await post(t.hr, '/surveys/questionnaires', {
          questionnaireId: ids.questionnaire,
          title: 'Y',
          anonymous: true,
          content,
        })
      ).status,
    ).toBe(409);
  });

  it('lets a technician answer by link, and forgets who he was once sent', async () => {
    const [token] = await linksOf('kofi@kya-demo.test');
    const screen = await call('', 'GET', `/public/surveys/${token}`);
    expect(screen.status).toBe(200);
    const forms = screen.body.forms as { formId: string }[];
    expect(forms).toHaveLength(1);
    const formId = forms[0]?.formId ?? '';
    const draft = await call('', 'POST', `/public/surveys/${token}/forms/${formId}`, {
      answers: { it_net: 4, unknown: 2 },
    });
    expect(draft.status).toBe(201);
    const incomplete = await call('', 'POST', `/public/surveys/${token}/forms/${formId}/submit`, {
      answers: { it_net: 4 },
    });
    expect(incomplete.body.error).toBe('incomplete');
    const sent = await call('', 'POST', `/public/surveys/${token}/forms/${formId}/submit`, {
      answers: { it_net: 4, it_help: 'na', hr_leave: 5, it_idea: 'Un meilleur wifi' },
    });
    expect(sent.status).toBe(201);
    const stored = await db.owner.query(
      `select respondent_id, answers from ${db.schema}.survey_forms where form_id = $1`,
      [formId],
    );
    expect(stored.rows[0]).toMatchObject({
      respondent_id: null,
      answers: { it_net: 4, it_help: 'na' },
    });
    expect(
      (await call('', 'POST', `/public/surveys/${token}/forms/${formId}/submit`, { answers: {} }))
        .body.error,
    ).toBe('not_yours');
  });

  it('lets a person with an account answer from her space', async () => {
    const mine = (await get(t.awa, '/surveys/mine')).body.surveys as { respondentId: string }[];
    expect(mine).toHaveLength(1);
    const respondent = mine[0]?.respondentId ?? '';
    const screen = (await get(t.awa, `/surveys/mine/${respondent}`)).body;
    const formId = (screen.forms as { formId: string }[])[0]?.formId ?? '';
    // Someone else's form is not reachable.
    expect((await get(t.member, `/surveys/mine/${respondent}`)).status).toBe(404);
    expect(
      (
        await post(t.awa, `/surveys/mine/${respondent}/forms/${formId}/submit`, {
          answers: { it_net: 2, it_help: 3, hr_leave: 4 },
        })
      ).status,
    ).toBe(201);
  });

  it('follows completion, and a reminder replaces the old link', async () => {
    const [before] = await linksOf('yaw@kya-demo.test');
    expect((await post(t.hr, `/surveys/campaigns/${ids.campaign}/remind`)).body).toMatchObject({
      reminded: 3,
    });
    const [after] = await linksOf('yaw@kya-demo.test');
    expect(after).not.toBe(before);
    expect((await call('', 'GET', `/public/surveys/${before}`)).status).toBe(404);
    const followed = (await get(t.hr, `/surveys/campaigns/${ids.campaign}`)).body;
    const respondents = followed.respondents as { name: string; status: string }[];
    expect(respondents.find((r) => r.name === 'Kofi')?.status).toBe('submitted');
    expect(followed.results).toBeNull();
  });

  it('closes its links, hides a group under three answers, and publishes', async () => {
    const [token] = await linksOf('yaw@kya-demo.test');
    const yawForm = (
      (await call('', 'GET', `/public/surveys/${token}`)).body.forms as { formId: string }[]
    )[0]?.formId;
    await call('', 'POST', `/public/surveys/${token}/forms/${yawForm}/submit`, {
      answers: { it_net: 5, it_help: 5, hr_leave: 3 },
    });
    expect((await post(t.hr, `/surveys/campaigns/${ids.campaign}/close`)).status).toBe(201);
    expect((await call('', 'GET', `/public/surveys/${token}`)).status).toBe(404);
    const results = (await get(t.hr, `/surveys/campaigns/${ids.campaign}`)).body.results as {
      forms: number;
      sections: { key: string; score: number | null; count: number; hidden: boolean }[];
      texts: { text: string }[];
    };
    expect(results.forms).toBe(3);
    // IT: ratings 4, 2, 3, 5, 5 → average 3.8 → (3.8 − 1) ÷ 4 × 100 = 70.
    expect(results.sections.find((s) => s.key === 'it')).toMatchObject({ count: 3, score: 70 });
    expect(results.texts.map((x) => x.text)).toEqual(['Un meilleur wifi']);
    expect(
      await inOrganization(db.app, 'org_kya', (tx) => surveyScores(tx, ids.campaign ?? '')),
    ).toBeNull();
    await post(t.hr, `/surveys/campaigns/${ids.campaign}/publish`);
    const scores = await inOrganization(db.app, 'org_kya', (tx) =>
      surveyScores(tx, ids.campaign ?? ''),
    );
    expect(scores).toMatchObject({ period: 'T3 2026' });
  });
});

describe('an evaluation of the manager', () => {
  it('draws, for each person, a form about whoever holds the position above, past vacancies', async () => {
    const questionnaire = id(
      await post(t.hr, '/surveys/questionnaires', {
        title: 'Évaluation du N+1',
        anonymous: true,
        content: {
          sections: [
            {
              key: 'm',
              title: 'Mon responsable',
              questions: [{ key: 'm_listen', type: 'rating', label: 'Écoute' }],
            },
          ],
        },
      }),
      'questionnaireId',
    );
    const campaign = id(
      await post(t.hr, '/surveys/campaigns', {
        questionnaireId: questionnaire,
        title: 'Évaluation T3',
        period: 'T3 2026',
        opensOn: '2026-10-01',
        closesOn: '2026-10-15',
        audience: { kind: 'units', unitIds: [ids.it] },
        about: 'manager',
        minGroup: 2,
      }),
      'campaignId',
    );
    const opened = await post(t.hr, `/surveys/campaigns/${campaign}/open`);
    // Kofi (about Yaw), Awa and Yao (about Kofi, the team leader's position being vacant).
    expect(opened.body).toMatchObject({ respondents: 3, forms: 3 });
    const { rows } = await db.owner.query<{ name: string; count: string }>(
      `select p.name, count(*) from ${db.schema}.survey_forms f
         join ${db.schema}.people p on p.person_id = f.about_person_id
        where f.campaign_id = $1 group by p.name order by p.name`,
      [campaign],
    );
    expect(rows).toEqual([
      { name: 'Kofi', count: '2' },
      { name: 'Yaw', count: '1' },
    ]);
  });
});

describe('customers, outside the organization', () => {
  it('answer by link, with no person behind them', async () => {
    const questionnaire = id(
      await post(t.hr, '/surveys/questionnaires', {
        title: 'Satisfaction client',
        anonymous: false,
        content: {
          sections: [
            {
              key: 'c',
              title: 'Nos prestations',
              questions: [
                { key: 'c_quality', type: 'rating', label: 'Qualité' },
                { key: 'c_again', type: 'yes_no', label: 'Recommanderiez-vous KYA ?' },
              ],
            },
          ],
        },
      }),
      'questionnaireId',
    );
    const campaign = id(
      await post(t.hr, '/surveys/campaigns', {
        questionnaireId: questionnaire,
        title: 'CSAT S2',
        period: 'S2 2026',
        opensOn: '2026-10-01',
        closesOn: '2026-12-15',
        audience: {
          kind: 'outside',
          people: [{ name: 'Mairie de Lomé', email: 'contact@client.test' }],
        },
      }),
      'campaignId',
    );
    expect((await post(t.hr, `/surveys/campaigns/${campaign}/open`)).body).toMatchObject({
      respondents: 1,
      sent: 1,
    });
    const [token] = await linksOf('contact@client.test');
    const screen = await call('', 'GET', `/public/surveys/${token}`);
    expect(screen.body.respondent).toMatchObject({ name: 'Mairie de Lomé' });
    const formId = (screen.body.forms as { formId: string }[])[0]?.formId;
    expect(
      (
        await call('', 'POST', `/public/surveys/${token}/forms/${formId}/submit`, {
          answers: { c_quality: 5, c_again: true },
        })
      ).status,
    ).toBe(201);
  });

  it('stop at the module: switched off, links open nothing', async () => {
    await post(t.admin, '/organization/modules', { module: 'surveys', enabled: false });
    expect((await get(t.hr, '/surveys')).body.error).toBe('module_disabled');
    await post(t.admin, '/organization/modules', { module: 'surveys', enabled: true });
  });
});
