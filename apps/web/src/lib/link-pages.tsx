import { Panel } from '@kete/design';
import * as m from '@/paraglide/messages.js';
import type { LinkInfo } from './admin';
import { SurveyAnswer } from './survey-answer';
import { fetchLinkSurvey, type AnswerScreen } from './surveys';

/**
 * What each purpose of a personal link shows. Each business tool adds its page here: the link
 * names its purpose (`surveys.answer`, `performance.review`), never a screen address.
 */
export type LinkPageData =
  { purpose: 'surveys.answer'; survey: AnswerScreen } | { purpose: 'unknown'; name: string };

export async function loadLinkPage(link: LinkInfo, token: string): Promise<LinkPageData | null> {
  if (link.purpose === 'surveys.answer') {
    const survey = await fetchLinkSurvey({ data: { token } });
    return survey ? { purpose: 'surveys.answer', survey } : null;
  }
  return { purpose: 'unknown', name: link.person.name };
}

export function LinkPage({ page, token }: { page: LinkPageData; token: string }) {
  if (page.purpose === 'surveys.answer') {
    return <SurveyAnswer screen={page.survey} via={`link:${token}`} />;
  }
  return (
    <Panel title={m.link_hello({ name: page.name })}>
      <p>{m.link_unknown_purpose()}</p>
    </Panel>
  );
}
