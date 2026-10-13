import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { callApi, sendGesture } from '@/platform/api';

// Connectors (spec 069): a business tool the organization already has, read through its MCP
// server — what waits there for a person lands in her « Décider ».

export interface Reading {
  tool: string;
  /** The tool's arguments, as JSON text: the form shows and edits them as written. */
  arguments: string;
  label: string;
  fields: { key: string; title: string; person: string };
  link: string;
}

export interface Connector {
  connectorId: string;
  name: string;
  address: string;
  hasSecret: boolean;
  reading: Reading;
  status: 'trial' | 'connected' | 'off';
  triedAt: string | null;
  lastReadAt: string | null;
  lastError: string | null;
}

export interface Preset {
  key: string;
  name: string;
  reading: Reading;
}

export interface ReadReport {
  found: number;
  filed: { key: string; title: string; person: string }[];
  unmatched: { key: string; email: string }[];
  closed: number;
}

type Served<T extends { reading: Reading }> = Omit<T, 'reading'> & {
  reading: Omit<Reading, 'arguments'> & { arguments: unknown };
};
const shown = <T extends { reading: Reading }>(served: Served<T>) =>
  ({
    ...served,
    reading: { ...served.reading, arguments: JSON.stringify(served.reading.arguments, null, 2) },
  }) as T;

export const fetchConnectors = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ connectors: Connector[]; presets: Preset[] }> => {
    const screen = await callApi<{ connectors: Served<Connector>[]; presets: Served<Preset>[] }>(
      getRequest(),
      '/v1/connectors',
    );
    return {
      connectors: screen.connectors.map((connector) => shown<Connector>(connector)),
      presets: screen.presets.map((preset) =>
        shown<Preset>({ key: preset.key, name: preset.name, reading: preset.reading }),
      ),
    };
  },
);

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const createConnector = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(text(v.arguments, 4000) || '{}');
    } catch {
      throw new Error('invalid_arguments');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('invalid_arguments');
    }
    const secret = typeof v.secret === 'string' ? v.secret.slice(0, 2000) : '';
    return {
      name: text(v.name, 80),
      address: text(v.address, 400),
      ...(secret ? { secret } : {}),
      reading: {
        tool: text(v.tool, 120),
        arguments: parsed as Record<string, unknown>,
        label: text(v.label, 60),
        fields: {
          key: text(v.fieldKey, 80),
          title: text(v.fieldTitle, 80),
          person: text(v.fieldPerson, 80),
        },
        link: text(v.link, 400),
      },
    };
  })
  .handler(async ({ data }) => {
    const answer = await sendGesture(getRequest(), '/v1/connectors', data, crypto.randomUUID());
    return answer.ok
      ? { ok: true as const, error: null }
      : { ok: false as const, error: answer.error };
  });

const connectorId = (value: unknown) => {
  if (typeof value !== 'string' || !/^cnr_[0-9a-f-]{8,64}$/.test(value)) {
    throw new Error('Unknown.');
  }
  return value;
};

export const tryConnector = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { connectorId?: unknown; file?: unknown };
    return { connectorId: connectorId(v.connectorId), file: v.file === true };
  })
  .handler(({ data }) =>
    sendGesture<{ report: ReadReport }>(
      getRequest(),
      `/v1/connectors/${data.connectorId}/${data.file ? 'read' : 'try'}`,
      {},
      crypto.randomUUID(),
    ),
  );

export const setConnectorStatus = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as { connectorId?: unknown; status?: unknown };
    if (v.status !== 'connected' && v.status !== 'off') throw new Error('Unknown.');
    return { connectorId: connectorId(v.connectorId), status: v.status as 'connected' | 'off' };
  })
  .handler(({ data }) =>
    sendGesture<{ status: string }>(
      getRequest(),
      `/v1/connectors/${data.connectorId}/status`,
      { status: data.status },
      crypto.randomUUID(),
    ),
  );
