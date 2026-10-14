import type { Hono } from 'hono';

// The demo's week in Planifier (spec 079): what the apps would have said of it — the colleague's
// leave on Thursday and Friday, the reception of the material on Friday, which is the colleague's
// too (a clash), the manager's bank meeting read from her own agenda (« busy »), an invoice's
// deadline. Relative to the week the demo runs in.

const DAY = 86_400_000;

function monday(now = new Date()): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  return new Date(today - weekday * DAY).toISOString().slice(0, 10);
}
const plus = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export async function seedTime(options: {
  api: Hono;
  admin: string;
  manager: string;
  colleague: string;
}): Promise<number> {
  const week = monday();
  const said: { source: string; fact: Record<string, unknown> }[] = [
    {
      source: 'kete-team',
      fact: {
        key: 'leave-colleague',
        kind: 'absence',
        label: 'Congé',
        day: plus(week, 3),
        until: plus(week, 4),
        person_ids: [options.colleague],
      },
    },
    {
      source: 'kete-commitments',
      fact: {
        key: 'reception',
        kind: 'task',
        label: 'Réception du matériel — Garage Bè',
        starts_at: `${plus(week, 4)}T10:00:00Z`,
        ends_at: `${plus(week, 4)}T11:00:00Z`,
        person_ids: [options.colleague],
      },
    },
    {
      source: 'agenda',
      fact: {
        key: 'bank',
        kind: 'meeting',
        label: 'Ecobank — ligne de crédit',
        starts_at: `${plus(week, 2)}T11:00:00Z`,
        ends_at: `${plus(week, 2)}T12:00:00Z`,
        person_ids: [options.manager],
        visibility: 'busy',
      },
    },
    {
      source: 'kete-team',
      fact: {
        key: 'site-meeting',
        kind: 'meeting',
        label: 'Point chantier Garage Bè',
        starts_at: `${plus(week, 1)}T09:00:00Z`,
        ends_at: `${plus(week, 1)}T09:30:00Z`,
        person_ids: [options.manager, options.colleague],
      },
    },
    {
      source: 'kete-finance',
      fact: { key: 'F-0412', kind: 'deadline', label: 'Échéance F-0412', day: plus(week, 3) },
    },
  ];
  let kept = 0;
  for (const [index, { source, fact }] of said.entries()) {
    const response = await options.api.request('/v1/time/facts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.admin}`,
        'content-type': 'application/json',
        'idempotency-key': `demo-time-${index}`,
      },
      body: JSON.stringify({ source, fact }),
    });
    if (response.ok) kept += 1;
  }
  return kept;
}
