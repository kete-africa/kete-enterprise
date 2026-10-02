import type { Actor, CommandDefinition } from '@kete/commands';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal, runCommand, runGesture } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readModules, requireModule } from '../organization/index.js';
import { requirePass, type PassVariables } from '../passes/index.js';
import { reach, reachesAnything } from '../rights/index.js';
import { personOfAccount } from '../structure/index.js';
import {
  answerPurpose,
  closeCampaign,
  copyQuestionnaire,
  createCampaign,
  openCampaign,
  publishResults,
  remindCampaign,
  reopenCampaign,
  resendLink,
  saveAnswers,
  saveQuestionnaire,
  submitForm,
  SurveyRuleError,
} from './commands.js';
import {
  findCampaign,
  findRespondent,
  formsOfRespondent,
  listCampaigns,
  listQuestionnaires,
  listRespondents,
  respondentsOfPerson,
  submittedForms,
} from './infrastructure/surveys.tables.js';
import { computeResults } from './scores.js';

type Ctx = Context<{ Variables: IdentityVariables }>;

/** The permissions this feature declares (spec 011). */
export const surveysPermissions = ['surveys:manage'] as const;

const statusOf: Record<SurveyRuleError['code'], 404 | 409 | 422 | 403> = {
  not_found: 404,
  used: 409,
  not_draft: 409,
  not_open: 409,
  not_closed: 409,
  submitted: 409,
  incomplete: 422,
  not_yours: 403,
  nobody: 422,
};

async function refused<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof SurveyRuleError) {
      throw new GestureRefusal(statusOf[error.code], error.code, error.message);
    }
    throw error;
  }
}

async function requireManager(c: Ctx): Promise<void> {
  const identity = c.get('identity');
  const scope = await transaction(identity.organizationId, (db) =>
    reach(db, identity, 'surveys:manage'),
  );
  if (!reachesAnything(scope)) {
    throw new GestureRefusal(403, 'forbidden', 'This needs the « surveys:manage » permission.');
  }
}

/** A managing gesture: the person runs the surveys; her e-mail relays links of people without one. */
function managed<Input extends z.ZodType, Output>(
  definition: CommandDefinition<Input, Output>,
  param?: string,
  relay = false,
) {
  return async (c: Ctx) => {
    await requireManager(c);
    const input = {
      ...((await bodyOf(c)) as object),
      ...(param ? { [param]: c.req.param(param) } : {}),
      ...(relay ? { relayEmail: c.get('identity').email || null } : {}),
    };
    return c.json(await refused(runGesture(c, definition, input)), 201);
  };
}

/** The respondent behind a signed-in person, if she is one of this campaign's. */
async function ownRespondent(c: Ctx, respondentId: string) {
  const identity = c.get('identity');
  return transaction(identity.organizationId, async (db) => {
    const person = await personOfAccount(db, identity.userId);
    const respondent = await findRespondent(db, respondentId);
    if (!person || !respondent || respondent.personId !== person.personId) {
      throw new GestureRefusal(404, 'not_found', 'No such form for you.');
    }
    return respondent;
  });
}

/** What a respondent sees: the campaign's frozen questionnaire and her own forms. */
async function respondentScreen(organizationId: string, respondentId: string) {
  return transaction(organizationId, async (db) => {
    const respondent = await findRespondent(db, respondentId);
    if (!respondent) throw new GestureRefusal(404, 'link_invalid', 'No such form.');
    const campaign = await findCampaign(db, respondent.campaignId);
    if (!campaign?.form || campaign.status !== 'open') {
      throw new GestureRefusal(409, 'not_open', 'This survey is not open.');
    }
    return {
      campaign: {
        title: campaign.title,
        period: campaign.period,
        closesOn: campaign.closesOn,
        anonymous: campaign.anonymous,
        form: campaign.form,
      },
      respondent: { name: respondent.name, status: respondent.status },
      forms: await formsOfRespondent(db, respondentId),
    };
  });
}

/** The surveys' routes for people signed in, under /v1/surveys (spec 011). */
export const surveysRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('surveys'))
  .get('/', async (c) => {
    await requireManager(c);
    const { organizationId } = c.get('identity');
    return c.json(
      await transaction(organizationId, async (db) => ({
        questionnaires: await listQuestionnaires(db),
        campaigns: (await listCampaigns(db)).map((campaign) => ({ ...campaign, form: null })),
      })),
    );
  })
  .post('/questionnaires', managed(saveQuestionnaire))
  .post('/questionnaires/:questionnaireId/copy', managed(copyQuestionnaire, 'questionnaireId'))
  .post('/campaigns', managed(createCampaign))
  .get('/campaigns/:campaignId', async (c) => {
    await requireManager(c);
    const { organizationId } = c.get('identity');
    const answer = await transaction(organizationId, async (db) => {
      const campaign = await findCampaign(db, c.req.param('campaignId'));
      if (!campaign) return null;
      const respondents = await listRespondents(db, campaign.campaignId);
      const results =
        campaign.form && (campaign.status === 'closed' || campaign.status === 'published')
          ? computeResults(campaign.form, await submittedForms(db, campaign.campaignId), campaign)
          : null;
      // In an anonymous campaign, follow-up shows who answered, never what.
      return { campaign, respondents, results };
    });
    if (!answer) throw new GestureRefusal(404, 'not_found', 'No such campaign.');
    return c.json(answer);
  })
  .post('/campaigns/:campaignId/open', managed(openCampaign, 'campaignId', true))
  .post('/campaigns/:campaignId/remind', managed(remindCampaign, 'campaignId', true))
  .post('/campaigns/:campaignId/close', managed(closeCampaign, 'campaignId'))
  .post('/campaigns/:campaignId/reopen', managed(reopenCampaign, 'campaignId', true))
  .post('/campaigns/:campaignId/publish', managed(publishResults, 'campaignId'))
  .post('/respondents/:respondentId/resend', managed(resendLink, 'respondentId', true))
  // What the signed-in person has to fill in.
  .get('/mine', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const person = await personOfAccount(db, identity.userId);
        return { surveys: person ? await respondentsOfPerson(db, person.personId) : [] };
      }),
    );
  })
  .get('/mine/:respondentId', async (c) => {
    const respondent = await ownRespondent(c, c.req.param('respondentId'));
    return c.json(
      await respondentScreen(c.get('identity').organizationId, respondent.respondentId),
    );
  })
  .post('/mine/:respondentId/forms/:formId', async (c) => {
    const respondent = await ownRespondent(c, c.req.param('respondentId'));
    const input = {
      ...((await bodyOf(c)) as object),
      formId: c.req.param('formId'),
      respondentId: respondent.respondentId,
    };
    return c.json(await refused(runGesture(c, saveAnswers, input)), 201);
  })
  .post('/mine/:respondentId/forms/:formId/submit', async (c) => {
    const respondent = await ownRespondent(c, c.req.param('respondentId'));
    const input = {
      ...((await bodyOf(c)) as object),
      formId: c.req.param('formId'),
      respondentId: respondent.respondentId,
    };
    return c.json(await refused(runGesture(c, submitForm, input)), 201);
  });

type PassCtx = Context<{ Variables: PassVariables }>;

/** The one answering through a link: the person, or the outside respondent. */
function linkActor(c: PassCtx): Actor {
  const pass = c.get('pass');
  return { kind: 'person', id: pass.personId ?? pass.reference, channel: 'web' };
}

async function moduleOn(c: PassCtx): Promise<void> {
  const modules = await transaction(c.get('pass').organizationId, (db) => readModules(db));
  if (!modules.surveys) {
    throw new GestureRefusal(403, 'module_disabled', 'Surveys are not on here.');
  }
}

function answerByLink<Input extends z.ZodType, Output>(
  definition: CommandDefinition<Input, Output>,
) {
  return async (c: PassCtx) => {
    await moduleOn(c);
    const pass = c.get('pass');
    const input = {
      ...((await bodyOf(c)) as object),
      formId: c.req.param('formId'),
      respondentId: pass.reference,
    };
    return c.json(
      await refused(
        runCommand(
          pass.organizationId,
          linkActor(c),
          c.req.header('idempotency-key'),
          definition,
          input,
        ),
      ),
      201,
    );
  };
}

/** A personal link's routes, under /public/surveys/:token (spec 011): its forms, nothing else. */
export const surveysPublicRoutes = new Hono<{ Variables: PassVariables }>()
  .use('/:token', requirePass(answerPurpose))
  .use('/:token/*', requirePass(answerPurpose))
  .get('/:token', async (c) => {
    await moduleOn(c);
    const pass = c.get('pass');
    return c.json(await respondentScreen(pass.organizationId, pass.reference));
  })
  .post('/:token/forms/:formId', answerByLink(saveAnswers))
  .post('/:token/forms/:formId/submit', answerByLink(submitForm));
