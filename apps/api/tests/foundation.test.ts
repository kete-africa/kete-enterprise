import { validateManifest } from '@kete/sdk';
import type { TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { bearer, startApi, tokenFor } from './support.js';

// Spec 001: the API answers for its health and its identity, and only to a person with a token.

let db: TestSchema;
const api = createApi();

beforeAll(async () => {
  db = await startApi();
});
afterAll(async () => {
  await db.drop();
});

describe('the API', () => {
  it('reports healthy, with its database', async () => {
    const response = await api.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'healthy',
      dependencies: [{ name: 'database', status: 'up' }],
    });
  });

  it('serves its manifest with its identity card (D-040)', async () => {
    const manifest = await (await api.request('/.well-known/kete')).json();
    expect(validateManifest(manifest).ok).toBe(true);
    expect(manifest).toMatchObject({
      product: 'prd_kete_enterprise',
      governance: { owner: { name: 'Kete' }, criticality: 'high' },
    });
  });

  it('says who is calling, in which organization', async () => {
    const response = await api.request(
      '/v1/me',
      bearer(await tokenFor('usr_awa', { role: 'owner' })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: 'usr_awa',
      name: 'usr_awa',
      email: 'usr_awa@example.test',
      organizationId: 'org_kya',
      role: 'owner',
      administrator: true,
      personId: null,
    });
  });

  it('refuses a call without a token, with a forged one, or without an organization', async () => {
    expect((await api.request('/v1/me')).status).toBe(401);
    expect((await api.request('/v1/me', bearer('not-a-token'))).status).toBe(401);
    const lonely = await api.request(
      '/v1/me',
      bearer(await tokenFor('usr_new', { org: null, role: null })),
    );
    expect(lonely.status).toBe(403);
    expect(await lonely.json()).toEqual({ error: 'no_organization' });
  });
});
