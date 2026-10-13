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
