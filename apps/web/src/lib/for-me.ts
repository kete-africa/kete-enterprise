import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture, type GestureAnswer } from '@/platform/api';

// « Pour moi » (doctrine D-057; specs 087, 089, 090): what a person must answer, what she holds,
// what she is told — her holdings in every source — and the cards « à classer » the router left
// her, each settled in one gesture and learned.

export interface Holding {
  holdingId: string;
  source: { app: string; kind: string; ref: string };
  object: { kind: string; id: string };
  what: string;
  holder: { kind: 'person' | 'agent'; id: string };
  waitingOn: { kind: 'person' | 'agent' | 'party'; id: string } | null;
  waitingSince: string | null;
  since: string;
  due: string | null;
  state: 'held' | 'waiting' | 'done';
  takenOverFrom: { kind: 'person' | 'agent'; id: string } | null;
  href: string;
}

export interface ForMe {
  toAnswer: Holding[];
  held: Holding[];
  information: Holding[];
}

export const fetchForMe = createServerFn({ method: 'GET' }).handler(() =>
  callApi<ForMe>(getRequest(), '/v1/pour-moi').catch((): ForMe => ({
    toAnswer: [],
    held: [],
    information: [],
  })),
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** She gives back a holding the relay gave her, with her reason. */
export const handBackHolding = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const holdingId = text(v.holdingId, 80);
    if (!/^hld_[0-9A-Za-z_-]{4,70}$/.test(holdingId)) throw new Error('Which holding?');
    return { holdingId, reason: text(v.reason, 500) };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ holding: Holding }>> =>
    sendGesture(
      getRequest(),
      `/v1/pour-moi/${data.holdingId}/rendre`,
      { reason: data.reason },
      crypto.randomUUID(),
    ),
  );

/** What a card « à classer » says it was received from: `whatsapp:wamid.…`, `mail:<id@host>`. */
export function receivedOf(holding: Holding): { via: string; ref: string } | null {
  if (holding.source.app !== 'channels' || holding.source.kind !== 'triage') return null;
  const at = holding.source.ref.indexOf(':');
  return at > 0
    ? { via: holding.source.ref.slice(0, at), ref: holding.source.ref.slice(at + 1) }
    : null;
}

/** She places what was received: in its object's thread, and the sender is learned. */
export const settleTriage = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    const via = text(v.via, 20);
    if (!['whatsapp', 'telegram', 'mail', 'form'].includes(via)) throw new Error('Which channel?');
    const kind = text(v.kind, 20);
    if (!['project', 'party'].includes(kind)) throw new Error('A project or a third party.');
    const intent = text(v.intent, 60) || 'client_message';
    return { via, ref: text(v.ref, 300), object: { kind, id: text(v.id, 200) }, intent };
  })
  .handler(async ({ data }): Promise<GestureAnswer<{ routing: { thread?: string } }>> =>
    sendGesture(getRequest(), '/v1/threads/triage/settle', data, crypto.randomUUID()),
  );

/** Where a card « à classer » may go: her projects, and the organization's third parties. */
export const fetchPlaces = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest();
  const [projects, parties] = await Promise.all([
    callApi<{ projects: { projectId: string; name: string; status: string }[] }>(
      request,
      '/v1/projects',
    ).catch(() => ({ projects: [] })),
    callApi<{ parties: { partyId: string; name: string }[] }>(request, '/v1/parties').catch(() => ({
      parties: [],
    })),
  ]);
  return {
    projects: projects.projects
      .filter((p) => p.status === 'open')
      .map((p) => ({ id: p.projectId, name: p.name })),
    parties: parties.parties.map((p) => ({ id: p.partyId, name: p.name })),
  };
});

/** The organization's fluidity (spec 087, FR-004): for its administrators, else nothing. */
export interface Fluidity {
  open: number;
  waiting: number;
  oldestWait: { holding: Holding; hours: number } | null;
  over48h: { waitingOn: { kind: string; id: string }; count: number; oldestHours: number }[];
}

export const fetchFluidity = createServerFn({ method: 'GET' }).handler(() =>
  callApi<Fluidity>(getRequest(), '/v1/work/figures').catch(() => null),
);
