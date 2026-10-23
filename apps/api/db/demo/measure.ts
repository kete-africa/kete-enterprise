import type { Hono } from 'hono';

/**
 * The Measure in the demo (spec 102): two indicators of KYA's referential get their source in the
 * center — the fleet's availability from the assets, the intervention deadline from the holdings —
 * each with its owner; the others stay typed with their proof. Through the API, as an administrator.
 */
export async function seedMeasure(options: { api: Hono; admin: string }): Promise<number> {
  let key = 0;
  const call = async (method: 'GET' | 'PUT', path: string, body?: object) => {
    const response = await options.api.request(path, {
      method,
      headers: {
        authorization: `Bearer ${options.admin}`,
        'content-type': 'application/json',
        'idempotency-key': `demo-measure-${++key}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return response.status < 300 ? ((await response.json()) as Record<string, unknown>) : null;
  };
  const listed = (await call('GET', '/v1/measure/indicators'))?.indicators as
    { indicatorId: string; name: string }[] | undefined;
  const chart = (await call('GET', '/v1/structure'))?.positions as
    { positionId: string; title: string }[] | undefined;
  const indicator = (name: string) => listed?.find((i) => i.name === name)?.indicatorId;
  const position = (title: string) => chart?.find((p) => p.title === title)?.positionId;
  const sources = [
    {
      name: 'Taux de disponibilité du parc sous contrat',
      owner: 'Directeur Technique & Projets',
      source: {
        kind: 'center',
        dataset: 'assets',
        measure: { fn: 'sum', field: 'in_service' },
        over: { measure: { fn: 'count' } },
      },
      target: 97,
      threshold: 95,
    },
    {
      name: "Respect du délai d'intervention contractuel (SLA)",
      owner: 'Chef de service SAV & Maintenance',
      source: {
        kind: 'center',
        dataset: 'holdings',
        measure: { fn: 'sum', field: 'done_in_time' },
        over: { measure: { fn: 'sum', field: 'done' } },
      },
      target: 95,
      threshold: 90,
    },
  ];
  let set = 0;
  for (const s of sources) {
    const id = indicator(s.name);
    if (!id) continue;
    const owner = position(s.owner);
    const done = await call('PUT', `/v1/measure/indicators/${id}/source`, {
      source: s.source,
      unit: 'percent',
      direction: 'higher',
      target: s.target,
      threshold: s.threshold,
      alertWhen: '<',
      ...(owner ? { ownerPositionId: owner } : {}),
    });
    if (done) set += 1;
  }
  return set;
}
