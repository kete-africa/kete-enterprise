import { z } from 'zod';

// An answer that is a tool (spec 063): a table a person sorts, filters and acts on. Its rows are
// what a tool read — code computed them — never what the model wrote. A tool says how to show
// what it read by giving `table` beside its `rows`; an app's tool does the same, with no view of
// its own to write.

/** How many rows a table shows in the thread; the rest is one click away, at its source. */
export const TABLE_ROWS = 200;

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const shape = z.object({
  title: z.string().trim().min(1).max(160),
  columns: z
    .array(
      z.object({
        /** The row's key this column reads. */
        key: z.string().min(1).max(120),
        /** The column's own name, in the words of its source. Empty for a measure. */
        label: z.string().max(120).default(''),
        kind: z.enum(['text', 'number', 'date']).default('text'),
        /** A figure computed over rows: the screens say it in words (« Somme de Montant »). */
        measure: z
          .object({
            fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
            column: z.string().max(80).nullable().default(null),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(12),
  /** Where it was read, and the page that shows all of it. */
  source: z.object({
    label: z.string().trim().min(1).max(160),
    href: z
      .string()
      .max(300)
      .regex(/^\/[^/]/)
      .nullable()
      .default(null),
  }),
});

export type AnswerTable = z.infer<typeof shape> & {
  rows: Record<string, string | number | boolean | null>[];
  /** More rows exist than are shown. */
  truncated: boolean;
};

/**
 * The table a tool's result carries, or null: `table` says how to show its `rows`. Only the
 * columns it names are kept; a result with no row is not a table.
 */
export function tableOf(result: unknown): AnswerTable | null {
  if (!result || typeof result !== 'object') return null;
  const value = result as { table?: unknown; rows?: unknown; truncated?: unknown };
  const parsed = shape.safeParse(value.table);
  if (!parsed.success || !Array.isArray(value.rows) || value.rows.length === 0) return null;
  const keys = parsed.data.columns.map((column) => column.key);
  const rows: AnswerTable['rows'] = [];
  for (const row of value.rows.slice(0, TABLE_ROWS)) {
    if (!row || typeof row !== 'object') return null;
    const kept: AnswerTable['rows'][number] = {};
    for (const key of keys) {
      const read = cell.safeParse((row as Record<string, unknown>)[key] ?? null);
      kept[key] = read.success ? read.data : null;
    }
    rows.push(kept);
  }
  return {
    ...parsed.data,
    rows,
    truncated: value.truncated === true || value.rows.length > TABLE_ROWS,
  };
}
