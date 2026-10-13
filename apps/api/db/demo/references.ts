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
 * The demo's facts of money (step F4): what an app would say of the Garage Bè site — a deposit
 * received, three expenses, an order placed, a milestone invoiced. Written in advance: Gestion
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
        source: 'Gestion (démonstration)',
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
