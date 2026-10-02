import {
  channels,
  CommandError,
  executeCommand,
  type Actor,
  type Channel,
  type CommandDefinition,
} from '@kete/commands';
import type { Context } from 'hono';
import type { z } from 'zod';
import { transaction } from './db.js';
import type { IdentityVariables } from './identity.js';

/** The person of the request, acting through the channel her client names (`web` for the screens). */
export function actorOf(c: Context<{ Variables: IdentityVariables }>): Actor {
  const named = c.req.header('kete-channel');
  const channel: Channel = channels.includes(named as Channel) ? (named as Channel) : 'api';
  return { kind: 'person', id: c.get('identity').userId, channel };
}

/** A refusal the caller can act on: its HTTP status, a stable code and a message. */
export class GestureRefusal extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Runs a named command for the person of the request, in her organization's transaction. */
export async function runGesture<Input extends z.ZodType, Output>(
  c: Context<{ Variables: IdentityVariables }>,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  const { organizationId } = c.get('identity');
  return runCommand(organizationId, actorOf(c), c.req.header('idempotency-key'), definition, input);
}

/**
 * Runs a named command for an actor of an organization (a person, or someone holding a personal
 * link): the change and its journal entry commit together, and the same key never runs it twice.
 */
export async function runCommand<Input extends z.ZodType, Output>(
  organizationId: string,
  actor: Actor,
  idempotencyKey: string | undefined,
  definition: CommandDefinition<Input, Output>,
  input: unknown,
): Promise<Output> {
  if (!idempotencyKey) {
    throw new GestureRefusal(422, 'idempotency_key_required', 'Send an Idempotency-Key header.');
  }
  try {
    const result = await transaction(organizationId, (db) =>
      executeCommand(db, definition, { organizationId, actor, idempotencyKey, input }),
    );
    return result.output;
  } catch (error) {
    if (error instanceof CommandError) {
      const status = error.code === 'idempotency_conflict' ? 409 : 422;
      throw new GestureRefusal(status, error.code, error.message);
    }
    throw error;
  }
}

/** The JSON body, or an empty object when there is none. */
export async function bodyOf(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
