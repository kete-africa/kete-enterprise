// The surveys feature's only door (spec 011).
import type { SqlExecutor } from '@kete/tenancy';
import { findCampaign, submittedForms } from './infrastructure/surveys.tables.js';
import { computeResults, type Results } from './scores.js';

export { answerPurpose, saveQuestionnaire, SurveyRuleError } from './commands.js';
export { respondentsOfPerson, surveysMigrationSql } from './infrastructure/surveys.tables.js';
export { surveysPermissions, surveysPublicRoutes, surveysRoutes } from './routes.js';
export { scoreOf, type Results } from './scores.js';
export type { FormContent, Questionnaire } from './surveys.record.js';

/**
 * A published campaign's scores, for the indicators (spec 012): the source of the six attributes.
 * Null while the campaign is not published.
 */
export async function surveyScores(
  db: SqlExecutor,
  campaignId: string,
): Promise<{ period: string; title: string; results: Results } | null> {
  const campaign = await findCampaign(db, campaignId);
  if (!campaign?.form || campaign.status !== 'published') return null;
  return {
    period: campaign.period,
    title: campaign.title,
    results: computeResults(campaign.form, await submittedForms(db, campaignId), campaign),
  };
}
