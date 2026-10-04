import type { CapabilityTool } from '@kete/capabilities';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { aggregate, querySpec } from '../datasets/index.js';
import { openRequest, registerSubjectFamily } from '../decisions/index.js';
import { readModules, requireModule } from '../organization/index.js';
import { issuePass, requirePass, revokePasses, type PassVariables } from '../passes/index.js';
import { isAdministrator } from '../rights/index.js';
import {
  asData,
  checkAnswers,
  collectionInput,
  createCollection,
  FormError,
  getCollection,
  insertSubmission,
  listCollections,
  setOpen,
  setSubmissionStatus,
  submissionsOf,
  type Collection,
} from './forms.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

/** The purpose of a collection's link: one link per collection, anyone holding it answers. */
const LINK_PURPOSE = 'forms.answer';
const LINK_DAYS = 90;

let listening = false;

/**
 * Each collection is a subject of the decisions engine (`forms.c…`): an answer goes through the
 * circuit an administrator defines for it, and its outcome is the answer's.
 */
export function listenForForms(): void {
  if (listening) return;
  listening = true;
  registerSubjectFamily(
    (subject) => subject.startsWith('forms.c'),
    async (db, reference, outcome) => setSubmissionStatus(db, reference, outcome),
    async (db) =>
      (await listCollections(db)).map((c) => ({
        subject: c.subject,
        label: { fr: c.name, en: c.name },
      })),
  );
}

/**
 * An answer kept, then — when a circuit exists for its collection — a request opened in the same
 * transaction, its measure the collection's measure field.
 */
async function submit(
  db: SqlExecutor,
  organizationId: string,
  collection: Collection,
  raw: Record<string, unknown>,
  by: { userId: string | null; name: string | null; requester: string },
) {
  if (!collection.open) throw new FormError('closed', 'This form is closed.');
  const values = checkAnswers(collection.fields, raw);
  const submissionId = await insertSubmission(db, {
    organizationId,
    collectionId: collection.collectionId,
    values,
    submittedBy: by.userId,
    submitterName: by.name,
  });
  const measure = collection.measureField ? values[collection.measureField] : null;
  const requestId = await openRequest(db, organizationId, {
    subject: collection.subject,
    reference: submissionId,
    title: `${collection.name}${by.name ? ` — ${by.name}` : ''}`,
    requesterUserId: by.requester,
    unitId: null,
    measure: typeof measure === 'number' ? measure : null,
  });
  if (requestId) {
    const status = await db.query<{ status: string }>(
      `select status from form_submissions where submission_id = $1`,
      [submissionId],
    );
    // A circuit whose every step is skipped approves at once.
    if (status.rows[0]?.status === 'received') {
      await setSubmissionStatus(db, submissionId, 'pending', requestId);
    }
  }
  return { submissionId, requested: Boolean(requestId) };
}

async function refusedForm<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof FormError) {
      throw new GestureRefusal(error.code === 'closed' ? 409 : 422, error.code, error.message);
    }
    throw error;
  }
}

/** The collection; whether she runs it (its owner, an administrator). */
async function found(c: Ctx, db: SqlExecutor) {
  const identity = c.get('identity');
  const collection = await getCollection(db, c.req.param('collectionId') ?? '');
  if (!collection) throw new GestureRefusal(404, 'not_found', 'No such form.');
  const manage =
    !c.get('viewedBy') && (collection.ownerId === identity.userId || isAdministrator(identity));
  if (!manage && collection.answeredBy !== 'everyone') {
    throw new GestureRefusal(404, 'not_found', 'No such form for her.');
  }
  return { collection, manage };
}

const forManager = (manage: boolean) => {
  if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner runs it.');
};

/** Forms, under /v1/forms (spec 032). */
export const formRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('forms'))
  .get('/', async (c) => {
    const identity = c.get('identity');
    const admin = isAdministrator(identity) && !c.get('viewedBy');
    const all = await transaction(identity.organizationId, (db) => listCollections(db));
    return c.json({
      // What she runs, and what she may answer.
      mine: all.filter((f) => admin || f.ownerId === identity.userId),
      toAnswer: all
        .filter((f) => f.answeredBy === 'everyone' && f.open)
        .map(({ submissions: _count, ...f }) => f),
    });
  })
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to create.');
    const parsed = collectionInput.safeParse(await bodyOf(c));
    if (!parsed.success) {
      throw new GestureRefusal(422, 'invalid_input', parsed.error.issues[0]?.message ?? 'A form.');
    }
    const identity = c.get('identity');
    const collection = await transaction(identity.organizationId, (db) =>
      createCollection(db, identity.organizationId, identity.userId, parsed.data),
    );
    return c.json({ collection }, 201);
  })
  .get('/:collectionId', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { collection, manage } = await found(c, db);
        const submissions = await submissionsOf(db, collection.collectionId, {
          ...(manage ? {} : { submittedBy: identity.userId }),
          limit: 200,
        });
        return { collection, manage, submissions };
      }),
    );
  })
  .post('/:collectionId', async (c) => {
    const parsed = z.object({ open: z.boolean() }).safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Open or closed.');
    const identity = c.get('identity');
    await transaction(identity.organizationId, async (db) => {
      const { collection, manage } = await found(c, db);
      forManager(manage);
      await setOpen(db, collection.collectionId, parsed.data.open);
      // A closed form opens no more by its link.
      if (!parsed.data.open) await revokePasses(db, LINK_PURPOSE, [collection.collectionId]);
    });
    return c.json({ open: parsed.data.open });
  })
  // Its link: anyone holding it answers, without an account — a new link replaces the previous.
  .post('/:collectionId/link', async (c) => {
    const identity = c.get('identity');
    const link = await transaction(identity.organizationId, async (db) => {
      const { collection, manage } = await found(c, db);
      forManager(manage);
      if (!collection.open) throw new GestureRefusal(409, 'closed', 'This form is closed.');
      return issuePass(db, identity.organizationId, {
        personId: null,
        purpose: LINK_PURPOSE,
        reference: collection.collectionId,
        expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
      });
    });
    return c.json({ url: link.url }, 201);
  })
  .post('/:collectionId/submit', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to answer.');
    const body = (await bodyOf(c)) as { values?: unknown };
    const identity = c.get('identity');
    const answered = await refusedForm(
      transaction(identity.organizationId, async (db) => {
        const { collection } = await found(c, db);
        return submit(
          db,
          identity.organizationId,
          collection,
          (body.values ?? {}) as Record<string, unknown>,
          { userId: identity.userId, name: identity.name, requester: identity.userId },
        );
      }),
    );
    return c.json(answered, 201);
  })
  // Its answers as data: the same query as a team's tables.
  .post('/:collectionId/query', async (c) => {
    const spec = querySpec.safeParse(await bodyOf(c));
    if (!spec.success) throw new GestureRefusal(422, 'invalid_input', 'A query.');
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { collection, manage } = await found(c, db);
        forManager(manage);
        const { columns, rows } = asData(
          collection,
          await submissionsOf(db, collection.collectionId),
        );
        const dated = rows.filter(
          (r) =>
            (!spec.data.from || r.answered_on >= spec.data.from) &&
            (!spec.data.to || r.answered_on <= spec.data.to),
        );
        try {
          return { rows: aggregate(columns, dated, spec.data) };
        } catch (error) {
          throw new GestureRefusal(422, 'invalid_query', (error as Error).message);
        }
      }),
    );
  });

/** `/public/forms/:token`: a collection's link, without an account. */
export const formsPublicRoutes = new Hono<{ Variables: PassVariables }>()
  .use('/:token', requirePass(LINK_PURPOSE))
  .use('/:token/*', requirePass(LINK_PURPOSE))
  .get('/:token', async (c) => {
    const pass = c.get('pass');
    const collection = await transaction(pass.organizationId, (db) =>
      getCollection(db, pass.reference),
    );
    if (!collection || !collection.open) {
      throw new GestureRefusal(404, 'link_invalid', 'This form is closed.');
    }
    const { name, description, fields } = collection;
    return c.json({ form: { name, description, fields } });
  })
  .post('/:token/submit', async (c) => {
    const pass = c.get('pass');
    const parsed = z
      .object({
        name: z.string().trim().max(200).optional(),
        values: z.record(z.string(), z.unknown()),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'Its answers.');
    const answered = await refusedForm(
      transaction(pass.organizationId, async (db) => {
        const collection = await getCollection(db, pass.reference);
        if (!collection) throw new GestureRefusal(404, 'link_invalid', 'No such form.');
        return submit(db, pass.organizationId, collection, parsed.data.values, {
          userId: null,
          name: parsed.data.name || null,
          requester: `link:${pass.passId}`,
        });
      }),
    );
    return c.json({ submitted: true, requested: answered.requested }, 201);
  });

/** Whether her organization uses forms. */
export async function formsOpen(identity: Identity): Promise<boolean> {
  return transaction(identity.organizationId, async (db) => (await readModules(db)).forms);
}

const queryInput = querySpec.extend({
  collectionId: z.string().min(1).max(80).describe('Le formulaire (form_collections)'),
});

/**
 * The assistant's tool (level 1, it reads): the answers of a form its person runs, summed up by
 * the same query as a team's data — columns `answered_on`, `status` and one per field.
 */
export function formTools(identity: Identity): CapabilityTool[] {
  return [
    {
      name: 'form_answers_query',
      description:
        'Calcule sur les réponses d’un formulaire que la personne gère : colonnes answered_on, status et une par champ ; filtres, regroupements, mesures count, sum, avg, min, max.',
      input: queryInput,
      jsonSchema: z.toJSONSchema(queryInput) as Record<string, unknown>,
      autonomy: 1,
      async execute(input) {
        const parsed = queryInput.safeParse(input);
        if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
        return transaction(identity.organizationId, async (db) => {
          const collection = await getCollection(db, parsed.data.collectionId);
          if (
            !collection ||
            (collection.ownerId !== identity.userId && !isAdministrator(identity))
          ) {
            return { status: 'done' as const, output: { error: 'not_found' } };
          }
          const { columns, rows } = asData(
            collection,
            await submissionsOf(db, collection.collectionId),
          );
          try {
            return {
              status: 'done' as const,
              output: { form: collection.name, rows: aggregate(columns, rows, parsed.data) },
            };
          } catch (error) {
            return { status: 'done' as const, output: { error: (error as Error).message } };
          }
        });
      },
    },
  ];
}
