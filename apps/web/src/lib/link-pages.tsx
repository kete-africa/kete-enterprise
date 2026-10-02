import { Panel } from '@kete/design';
import * as m from '@/paraglide/messages.js';
import type { LinkInfo } from './admin';

/**
 * What each purpose of a personal link shows. Each business tool adds its page here: the link
 * names its purpose (`surveys.answer`, `performance.review`), never a screen address.
 */
export function LinkPage({ link }: { link: LinkInfo; token: string }) {
  return (
    <Panel title={m.link_hello({ name: link.person.name })}>
      <p>{m.link_unknown_purpose()}</p>
    </Panel>
  );
}
