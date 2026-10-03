import { afterEach, describe, expect, it } from 'vitest';
import { appToolsFor } from '../src/features/gateway/index.js';
import { tokenForAgent, useMandates } from '../src/platform/mandates.js';

// Spec 024: an agent carries the person's mandate to the team's apps; without one, it calls none.

afterEach(() => useMandates(null));

describe('an agent’s mandate', () => {
  it('goes instead of the person’s token when mandates are on', async () => {
    useMandates(async (token, agent) => `mandate(${token},${agent.id})`);
    expect(await tokenForAgent('her-token', { id: 'agt_assistant', name: 'Assistant' })).toBe(
      'mandate(her-token,agt_assistant)',
    );
  });

  it('keeps the person’s token while mandates are off', async () => {
    useMandates(null);
    expect(await tokenForAgent('her-token', { id: 'agt_assistant', name: 'Assistant' })).toBe(
      'her-token',
    );
  });

  it('calls no app when the Compte Kete refuses the mandate', async () => {
    useMandates(async () => null);
    const apps = await appToolsFor(
      { userId: 'usr_x', role: 'member', organizationId: 'org_kya' },
      'her-token',
    );
    expect(apps.tools).toEqual([]);
  });
});
