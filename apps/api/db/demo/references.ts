import type { Hono } from 'hono';

// The demo's references (doctrine D-047): the third parties KYA works with. One of them was
// written twice — as a client by sales, as a supplier by purchases — so that the duplicate and its
// merge can be seen. Fictitious companies, fictitious numbers.

const parties = [
  { name: 'Garage Bè', roles: ['client'], phone: '+228 90 00 41 12', channel: 'whatsapp' },
  { name: 'Hôtel du Golfe', roles: ['client'], phone: '+228 90 12 34 56', channel: 'whatsapp' },
  { name: 'Hotel du Golf SARL', roles: ['supplier'], phone: '90123456' },
  { name: 'Solartech', roles: ['supplier'], email: 'ventes@solartech.example' },
  { name: 'Fonds Écoles solaires', roles: ['funder'], email: 'programme@fonds-ecoles.example' },
  { name: 'M. Kossi', kind: 'person', roles: ['client'], phone: '+228 91 55 02 07' },
];

/** Writes the demo's third parties as its administrator. */
export async function seedParties(options: { api: Hono; admin: string }): Promise<number> {
  let written = 0;
  for (const [index, party] of parties.entries()) {
    const response = await options.api.request('/v1/parties', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.admin}`,
        'content-type': 'application/json',
        'idempotency-key': `demo-party-${index}`,
      },
      body: JSON.stringify(party),
    });
    if (response.status < 300) written += 1;
  }
  return written;
}

/**
 * The demo's project (step F2): the Garage Bè site, led by the head of after-sales, with what it
 * was sold for and its budget by post. Returns whether it was written.
 */
export async function seedProject(options: {
  api: Hono;
  admin: string;
  lead: { userId: string; name: string };
}): Promise<boolean> {
  const headers = (key: string) => ({
    authorization: `Bearer ${options.admin}`,
    'content-type': 'application/json',
    'idempotency-key': key,
  });
  const listed = await options.api.request('/v1/parties?q=Garage', { headers: headers('demo-p') });
  const found = (await listed.json()) as { parties?: { partyId: string }[] };
  const made = await options.api.request('/v1/projects', {
    method: 'POST',
    headers: headers('demo-project-1'),
    body: JSON.stringify({
      name: 'Chantier Garage Bè',
      ...(found.parties?.[0] ? { partyId: found.parties[0].partyId } : {}),
      lead: options.lead,
      phase: 'Exécution',
      sold: 2_480_000,
      posts: [
        { name: 'Matériel', budget: 1_450_000 },
        { name: 'Main-d’œuvre', budget: 300_000 },
        { name: 'Déplacements', budget: 150_000 },
      ],
    }),
  });
  return made.status < 300;
}

/**
 * The demo's places and assets (spec 100): where things are, and what the organization installed
 * and keeps — the Garage Bè site's solar plant, born of its project, and three more — held by the
 * head of after-sales, in her unit. Returns how many assets were written.
 */
export async function seedAssets(options: {
  api: Hono;
  admin: string;
  holder: { userId: string };
}): Promise<number> {
  const headers = (key: string) => ({
    authorization: `Bearer ${options.admin}`,
    'content-type': 'application/json',
    'idempotency-key': key,
  });
  const read = async <T>(path: string, key: string) =>
    (await (await options.api.request(path, { headers: headers(key) })).json()) as T;
  type Found = { objects?: { kind: string; id: string; title: string }[] };
  const units = (await read<Found>('/v1/objects?kind=unit&limit=200', 'demo-a1')).objects ?? [];
  const unit =
    units.find((u) => /après-vente|SAV|maintenance/i.test(u.title)) ?? units[0] ?? undefined;
  const parties = (await read<Found>('/v1/objects?kind=party&limit=200', 'demo-a2')).objects ?? [];
  const partyOf = (name: string) => parties.find((p) => p.title === name)?.id;
  const projects = (await read<Found>('/v1/objects?kind=project', 'demo-a3')).objects ?? [];
  const project = projects.find((p) => p.title === 'Chantier Garage Bè')?.id;
  const post = async (path: string, key: string, body: object) => {
    const response = await options.api.request(path, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(body),
    });
    return response.status < 300 ? ((await response.json()) as Record<string, unknown>) : null;
  };
  const place = async (key: string, name: string, party: string | undefined, address: string) =>
    (
      (
        await post('/v1/places', key, {
          name,
          subtype: 'site',
          address,
          ...(unit ? { unitId: unit.id } : {}),
          ...(party ? { partyId: party } : {}),
        })
      )?.place as { placeId: string } | undefined
    )?.placeId;
  const garage = await place(
    'demo-place-1',
    'Garage Bè · atelier',
    partyOf('Garage Bè'),
    'Bè, Lomé',
  );
  const golfe = await place(
    'demo-place-2',
    'Hôtel du Golfe',
    partyOf('Hôtel du Golfe'),
    'Bd du 13 Janvier, Lomé',
  );
  const assets = [
    {
      name: 'Mini-centrale · Garage Bè',
      subtype: 'mini-centrale',
      state: 'alert',
      partyId: partyOf('Garage Bè'),
      projectId: project,
      placeId: garage,
      commissionedOn: '2026-06-12',
      warrantyUntil: '2031-06-12',
      facts: [
        { label: 'Puissance', value: '8 kWc' },
        { label: 'Stockage', value: '8 batteries 200 Ah' },
      ],
    },
    {
      name: 'Onduleur 5 kW · Garage Bè',
      subtype: 'onduleur',
      state: 'in_service',
      partyId: partyOf('Garage Bè'),
      projectId: project,
      placeId: garage,
      serial: 'INV-5K-0412',
    },
    {
      name: 'Kit solaire · Hôtel du Golfe',
      subtype: 'kit solaire',
      state: 'maintenance',
      partyId: partyOf('Hôtel du Golfe'),
      placeId: golfe,
      facts: [{ label: 'Puissance', value: '3 kWc' }],
    },
    {
      name: 'Climatiseur solaire · Hôtel du Golfe',
      subtype: 'climatiseur',
      state: 'in_service',
      partyId: partyOf('Hôtel du Golfe'),
      placeId: golfe,
    },
  ];
  let written = 0;
  for (const [index, asset] of assets.entries()) {
    const body = Object.fromEntries(Object.entries(asset).filter(([, v]) => v !== undefined));
    const made = await post('/v1/assets', `demo-asset-${index}`, {
      ...body,
      ...(unit ? { unitId: unit.id } : {}),
      holderUserId: options.holder.userId,
    });
    if (made) written += 1;
  }
  return written;
}

/**
 * The demo's facts of money (step F4): what an app would say of the Garage Bè site — a deposit
 * received, three expenses, an order placed, a milestone invoiced. Written in advance: Kete Finance
 * does not exist yet. Its orders exceed what is left of its funds, so the alert can be seen.
 */
export async function seedMoney(options: { api: Hono; admin: string }): Promise<number> {
  const headers = (key: string) => ({
    authorization: `Bearer ${options.admin}`,
    'content-type': 'application/json',
    'idempotency-key': key,
  });
  const listed = await options.api.request('/v1/projects', { headers: headers('demo-m') });
  const found = (await listed.json()) as { projects?: { projectId: string; name: string }[] };
  const project = found.projects?.find((candidate) => candidate.name === 'Chantier Garage Bè');
  if (!project) return 0;
  const facts = [
    { key: 'ENC-0007', kind: 'received', amount: 992_000, label: 'Acompte de 40 %' },
    {
      key: 'DEP-0101',
      kind: 'spent',
      amount: 620_000,
      label: 'Batteries 200 Ah',
      post: 'Matériel',
    },
    {
      key: 'DEP-0102',
      kind: 'spent',
      amount: 180_000,
      label: 'Pose, semaine 1',
      post: 'Main-d’œuvre',
    },
    {
      key: 'DEP-0103',
      kind: 'spent',
      amount: 96_000,
      label: 'Carburant et péages',
      post: 'Déplacements',
    },
    {
      key: 'BC-0031',
      kind: 'committed',
      amount: 700_000,
      label: 'Bon de commande BC-0031',
      post: 'Matériel',
    },
    { key: 'F-0412', kind: 'invoiced', amount: 744_000, label: 'Jalon « Livraison »' },
  ];
  let said = 0;
  for (const fact of facts) {
    const response = await options.api.request('/v1/money/facts', {
      method: 'POST',
      headers: headers(`demo-money-${fact.key}`),
      body: JSON.stringify({
        source: 'Kete Finance (démonstration)',
        fact: {
          ...fact,
          currency: 'XOF',
          occurred_on: '2026-10-09',
          project_id: project.projectId,
        },
      }),
    });
    if (response.status < 300) said += 1;
  }
  return said;
}
