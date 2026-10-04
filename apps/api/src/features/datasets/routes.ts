import type { CapabilityTool } from '@kete/capabilities';
import { readTable, SheetError, tabular } from '@kete/files';
import type { SqlExecutor } from '@kete/tenancy';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { transaction } from '../../platform/db.js';
import { bodyOf, GestureRefusal } from '../../platform/gestures.js';
import type { IdentityVariables } from '../../platform/identity.js';
import { readerKeys } from '../knowledge/index.js';
import { readModules, requireModule } from '../organization/index.js';
import { isAdministrator } from '../rights/index.js';
import {
  aggregate,
  createDataset,
  getDataset,
  listDatasets,
  QueryError,
  querySpec,
  readRows,
  removeDataset,
  replaceRows,
  updateDataset,
  type TeamDataset,
} from './datasets.js';

type Ctx = Context<{ Variables: IdentityVariables }>;
type Identity = IdentityVariables['identity'];

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 50_000;
/** At most this many rows are summed up by one query. */
const QUERY_ROWS = 50_000;

const fileInput = z.object({
  fileName: z.string().trim().min(1).max(300),
  contentType: z.string().min(3).max(120),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8),
  sheet: z.string().max(160).optional(),
});

/** A spreadsheet's or a CSV's first (or named) sheet, typed. */
async function tableOf(input: z.infer<typeof fileInput>) {
  if (!tabular(input.contentType)) {
    throw new GestureRefusal(422, 'unsupported_file', 'Excel, OpenDocument or CSV.');
  }
  const bytes = new Uint8Array(Buffer.from(input.data, 'base64'));
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new GestureRefusal(422, 'file_too_large', '20 MB at most.');
  }
  try {
    const table = await readTable(input.contentType, bytes, {
      maxRows: MAX_ROWS,
      ...(input.sheet ? { sheet: input.sheet } : {}),
    });
    if (!table.rows.length) throw new GestureRefusal(422, 'unreadable_file', 'No rows.');
    return table;
  } catch (error) {
    if (error instanceof SheetError)
      throw new GestureRefusal(422, 'unreadable_file', error.message);
    throw error;
  }
}

/** The data set, if she may read it; whether she may change it (its owner, an administrator). */
async function visible(c: Ctx, db: SqlExecutor) {
  const identity = c.get('identity');
  const dataset = await getDataset(db, c.req.param('datasetId') ?? '');
  const admin = isAdministrator(identity) && !c.get('viewedBy');
  const keys = new Set(await readerKeys(db, identity));
  if (!dataset || (!admin && !dataset.audience.some((k) => keys.has(k)))) {
    throw new GestureRefusal(404, 'not_found', 'No such data set for her.');
  }
  const owner = dataset.ownerId === identity.userId && !c.get('viewedBy');
  return { dataset, manage: admin || owner, admin };
}

const audienceKey = z
  .string()
  .regex(/^(everyone|role:admin|unit:[A-Za-z0-9_.-]{1,80}|user:[A-Za-z0-9_.-]{1,80})$/);

function summarized(dataset: TeamDataset, rows: Parameters<typeof aggregate>[1], spec: unknown) {
  const parsed = querySpec.safeParse(spec);
  if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A query.');
  try {
    return aggregate(dataset.columns, rows, parsed.data);
  } catch (error) {
    if (error instanceof QueryError) throw new GestureRefusal(422, 'invalid_query', error.message);
    throw error;
  }
}

/** A team's data, under /v1/datasets (spec 031). */
export const datasetRoutes = new Hono<{ Variables: IdentityVariables }>()
  .use('*', requireModule('datasets'))
  .get('/', async (c) => {
    const identity = c.get('identity');
    const admin = isAdministrator(identity) && !c.get('viewedBy');
    const datasets = await transaction(identity.organizationId, async (db) =>
      listDatasets(db, admin ? null : await readerKeys(db, identity)),
    );
    return c.json({ manage: admin, datasets });
  })
  // A table brought by a person: hers alone until an administrator opens it to others.
  .post('/', async (c) => {
    if (c.get('viewedBy')) throw new GestureRefusal(403, 'view_as_forbidden', 'Hers to bring.');
    const parsed = fileInput
      .extend({
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(1000).optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A name and a file.');
    const table = await tableOf(parsed.data);
    const identity = c.get('identity');
    const dataset = await transaction(identity.organizationId, (db) =>
      createDataset(db, {
        organizationId: identity.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        ownerId: identity.userId,
        audience: [`user:${identity.userId}`],
        columns: table.columns,
        rows: table.rows,
        sourceName: parsed.data.fileName,
      }),
    );
    return c.json({ dataset }, 201);
  })
  .get('/:datasetId', async (c) => {
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { dataset, manage } = await visible(c, db);
        const { rows } = await readRows(db, dataset, { limit: 50 });
        return { dataset, manage, preview: rows };
      }),
    );
  })
  // Its rows, as the apps' data sets serve theirs (dataset.v1): dated, limited.
  .get('/:datasetId/rows', async (c) => {
    const query = z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(500),
      })
      .safeParse(c.req.query());
    if (!query.success) throw new GestureRefusal(422, 'invalid_input', 'from, to, limit.');
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { dataset } = await visible(c, db);
        return { dataset: dataset.name, ...(await readRows(db, dataset, query.data)) };
      }),
    );
  })
  .post('/:datasetId/query', async (c) => {
    const spec = await bodyOf(c);
    const identity = c.get('identity');
    return c.json(
      await transaction(identity.organizationId, async (db) => {
        const { dataset } = await visible(c, db);
        const range = spec as { from?: string; to?: string };
        const { rows, truncated } = await readRows(db, dataset, {
          from: range.from,
          to: range.to,
          limit: QUERY_ROWS,
        });
        return { rows: summarized(dataset, rows, spec), truncated };
      }),
    );
  })
  // A new version of its table, by its owner or an administrator.
  .post('/:datasetId/rows', async (c) => {
    const parsed = fileInput.safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'A file.');
    const table = await tableOf(parsed.data);
    const identity = c.get('identity');
    const dataset = await transaction(identity.organizationId, async (db) => {
      const { dataset: found, manage } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner updates it.');
      await replaceRows(db, {
        organizationId: identity.organizationId,
        datasetId: found.datasetId,
        columns: table.columns,
        rows: table.rows,
        sourceName: parsed.data.fileName,
      });
      return getDataset(db, found.datasetId);
    });
    return c.json({ dataset }, 201);
  })
  .post('/:datasetId', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        description: z.string().trim().max(1000).optional(),
        audience: z.array(audienceKey).min(1).max(50).optional(),
      })
      .safeParse(await bodyOf(c));
    if (!parsed.success) throw new GestureRefusal(422, 'invalid_input', 'What changes?');
    const identity = c.get('identity');
    const dataset = await transaction(identity.organizationId, async (db) => {
      const { dataset: found, manage, admin } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner decides.');
      if (parsed.data.audience && !admin) {
        throw new GestureRefusal(403, 'forbidden', 'Administrators open data to others.');
      }
      const change = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined),
      ) as { name?: string; description?: string; audience?: string[] };
      return updateDataset(db, found.datasetId, change);
    });
    return c.json({ dataset });
  })
  .post('/:datasetId/remove', async (c) => {
    const identity = c.get('identity');
    const removed = await transaction(identity.organizationId, async (db) => {
      const { dataset, manage } = await visible(c, db);
      if (!manage) throw new GestureRefusal(403, 'forbidden', 'Its owner decides.');
      return removeDataset(db, dataset.datasetId);
    });
    return c.json({ removed });
  });

/** Whether her organization uses team data. */
export async function datasetsOpen(identity: Identity): Promise<boolean> {
  return transaction(identity.organizationId, async (db) => (await readModules(db)).datasets);
}

const listInput = z.object({});
const queryInput = querySpec.extend({
  datasetId: z.string().min(1).max(80).describe('Le jeu de données (team_datasets)'),
});

/**
 * The assistant's tools (level 1: they read): the team data she may read, with their columns, and
 * a query that sums them up — filters, groups, measures — so that its figures come from the rows.
 */
export function datasetTools(identity: Identity): CapabilityTool[] {
  return [
    {
      name: 'team_datasets',
      description:
        'Liste les données des équipes que la personne peut lire (tableaux Excel ou CSV déposés) : leur nom, leurs colonnes et leur type.',
      input: listInput,
      jsonSchema: z.toJSONSchema(listInput) as Record<string, unknown>,
      autonomy: 1,
      async execute() {
        const datasets = await transaction(identity.organizationId, async (db) =>
          listDatasets(db, await readerKeys(db, identity)),
        );
        return {
          status: 'done',
          output: {
            datasets: datasets.map((d) => ({
              datasetId: d.datasetId,
              name: d.name,
              description: d.description,
              columns: d.columns,
              rows: d.rowCount,
            })),
          },
        };
      },
    },
    {
      name: 'team_data_query',
      description:
        'Calcule sur les lignes d’un jeu de données : filtres, regroupements (3 au plus), mesures count, sum, avg, min, max. Utilise-le pour tout chiffre tiré des données des équipes ; ne calcule jamais de tête.',
      input: queryInput,
      jsonSchema: z.toJSONSchema(queryInput) as Record<string, unknown>,
      autonomy: 1,
      async execute(input) {
        const parsed = queryInput.safeParse(input);
        if (!parsed.success) return { status: 'refused', reason: 'invalid_input' };
        try {
          return await transaction(identity.organizationId, async (db) => {
            const dataset = await getDataset(db, parsed.data.datasetId);
            const keys = new Set(await readerKeys(db, identity));
            if (!dataset || !dataset.audience.some((k) => keys.has(k))) {
              return { status: 'done' as const, output: { error: 'not_found' } };
            }
            const { rows, truncated } = await readRows(db, dataset, {
              from: parsed.data.from,
              to: parsed.data.to,
              limit: QUERY_ROWS,
            });
            return {
              status: 'done' as const,
              output: {
                dataset: dataset.name,
                rows: aggregate(dataset.columns, rows, parsed.data),
                truncated,
              },
            };
          });
        } catch (error) {
          if (error instanceof QueryError) {
            return { status: 'done', output: { error: error.message } };
          }
          throw error;
        }
      },
    },
  ];
}
