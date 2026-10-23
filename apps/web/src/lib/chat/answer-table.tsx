import { Button, CopyButton, DataTable, Icon, type Column } from '@kete/design';
import {
  columnFilteringFeature,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import type { AnswerTable as AnswerTableData } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// An answer that is a tool (spec 063): the rows a tool read, as a table she sorts, filters and
// acts on. Sorting, filtering and selection are TanStack Table's; the table is @kete/design's.
// Acting on rows puts them in the composer: she says what she wants done, and the assistant
// prepares it — nothing is done from here.

type Line = AnswerTableData['rows'][number];

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  filterFns: { includesString: filterFn_includesString },
});

type Shown = AnswerTableData['columns'][number];

/** A column's name: its source's own words, or a measure said in ours. */
function labelOf(column: Shown): string {
  const measure = column.measure;
  if (!measure) return column.label || column.key;
  const name = { column: measure.column ?? '' };
  if (measure.fn === 'count') {
    return measure.column ? m.table_measure_count_of(name) : m.table_measure_count();
  }
  return {
    sum: m.table_measure_sum,
    avg: m.table_measure_avg,
    min: m.table_measure_min,
    max: m.table_measure_max,
  }[measure.fn](name);
}

function sayCell(value: Line[string] | undefined, kind: Shown['kind']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return new Intl.NumberFormat(getLocale()).format(value);
  if (typeof value === 'boolean') return value ? m.table_yes() : m.table_no();
  if (kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(date);
    }
  }
  return value;
}

/** Rows as she would paste them in a sheet: tabs between cells, the names first. */
const asText = (columns: Shown[], lines: Line[]) =>
  [
    columns.map(labelOf).join('\t'),
    ...lines.map((line) => columns.map((column) => String(line[column.key] ?? '')).join('\t')),
  ].join('\n');

/** A row in a sentence, to speak of it to the assistant. */
const asSentence = (columns: Shown[], line: Line) =>
  columns
    .filter((column) => line[column.key] !== null && line[column.key] !== '')
    .map((column) => `${labelOf(column)} : ${sayCell(line[column.key], column.kind)}`)
    .join(' ; ');

export function AnswerTable({
  table: answer,
  onSpeak,
}: {
  table: AnswerTableData;
  /** Puts words in Kete Intelligence's field, for her to finish. */
  onSpeak?: (text: string) => void;
}) {
  const columns = useMemo(
    () =>
      answer.columns.map((column): ColumnDef<typeof features, Line> => ({
        id: column.key,
        accessorFn: (line) => line[column.key] ?? undefined,
        sortFn: column.kind === 'number' ? 'basic' : 'alphanumeric',
        sortUndefined: 'last',
      })),
    [answer.columns],
  );
  const table = useTable({
    features,
    columns,
    data: answer.rows,
    globalFilterFn: 'includesString',
    getColumnCanGlobalFilter: () => true,
    enableSortingRemoval: true,
  });
  const rows = table.getRowModel().rows;
  const chosen = table.getSelectedRowModel().rows;
  const sorting = table.state.sorting;

  /** Puts rows in the composer: she adds what she wants done with them. */
  const speakOf = (lines: Line[]) => {
    const said = m.table_about_rows({
      title: answer.title,
      rows: lines.map((line) => `- ${asSentence(answer.columns, line)}`).join('\n'),
    });
    onSpeak?.(`${said}\n`);
  };

  const shown: Column<Row<typeof features, Line>>[] = [
    {
      key: '__select',
      label: (
        <input
          type="checkbox"
          aria-label={m.table_select_all()}
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          aria-label={m.table_select_row()}
          checked={row.getIsSelected()}
          onClick={row.getToggleSelectedHandler()}
          readOnly
        />
      ),
    },
    ...answer.columns.map((column): Column<Row<typeof features, Line>> => {
      const sorted = sorting.find((sort) => sort.id === column.key);
      const label = labelOf(column);
      return {
        key: column.key,
        align: column.kind === 'number' ? 'end' : 'start',
        label: (
          <button
            type="button"
            onClick={() => table.getColumn(column.key)?.toggleSorting()}
            aria-label={m.table_sort_by({ column: label })}
            className="inline-flex items-center gap-1 font-semibold hover:text-fg"
          >
            {label}
            {sorted && <Icon name={sorted.desc ? 'down' : 'up'} size={12} />}
          </button>
        ),
        render: (row) => sayCell(row.original[column.key], column.kind),
      };
    }),
    // « Agir » only where there is a field to say it in.
    ...(onSpeak
      ? [
          {
            key: '__act',
            label: <span className="sr-only">{m.table_act()}</span>,
            align: 'end' as const,
            render: (row: Row<typeof features, Line>) => (
              <button
                type="button"
                onClick={() => speakOf([row.original])}
                className="font-semibold text-link underline"
              >
                {m.table_act()}
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <section
      aria-label={answer.title}
      className="my-2 grid min-w-0 gap-2 rounded-box border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-body font-semibold">{answer.title}</h3>
        <label className="flex items-center gap-2 text-body-sm text-fg-muted">
          {m.table_filter()}
          <input
            type="search"
            value={table.state.globalFilter ?? ''}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            aria-label={m.table_filter_label()}
            className="h-8 w-44 rounded-control border border-line-control bg-surface-control px-2 text-fg outline-0 focus:border-accent"
          />
        </label>
      </div>
      <div className="max-h-[420px] min-w-0 overflow-auto">
        <DataTable
          caption={answer.title}
          columns={shown}
          rows={rows}
          rowKey={(row) => row.id}
          empty={m.table_no_match()}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm text-fg-muted">
        <span>
          {m.table_rows({ shown: rows.length, total: answer.rows.length })}
          {answer.truncated && ` ${m.table_truncated()}`}{' '}
          {answer.source.href ? (
            <a href={answer.source.href} className="text-link underline">
              {m.table_source({ label: answer.source.label })}
            </a>
          ) : (
            m.table_source({ label: answer.source.label })
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {chosen.length > 0 && onSpeak && (
            <Button onClick={() => speakOf(chosen.map((row) => row.original))}>
              {m.table_act_selection({ count: chosen.length })}
            </Button>
          )}
          <CopyButton
            text={asText(
              answer.columns,
              (chosen.length > 0 ? chosen : rows).map((row) => row.original),
            )}
            label={m.table_copy()}
            copiedLabel={m.common_copied()}
          />
        </span>
      </div>
    </section>
  );
}
