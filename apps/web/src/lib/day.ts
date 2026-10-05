import type { IconName } from '@kete/design';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import type { DayItem } from './today';

// The words of what waits (specs 046, 047): « Aujourd'hui » and « À faire » say them the same way.

export const kindIcon: Record<DayItem['kind'], IconName> = {
  decision: 'check',
  draft: 'sparkle',
  app_task: 'flag',
  form: 'teach',
  action: 'people',
  note: 'file',
};

export function kindLabel(kind: DayItem['kind']): string {
  return {
    decision: m.todo_kind_decision,
    draft: m.todo_kind_draft,
    app_task: m.todo_kind_app_task,
    form: m.todo_kind_form,
    action: m.todo_kind_action,
    note: m.todo_kind_note,
  }[kind]();
}

/** Things to decide come first; the rest is to complete. */
export const toDecide = (item: DayItem) => item.kind === 'decision' || item.kind === 'draft';

export const dayOf = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long' }).format(new Date(value));

/** Why a thing waits, in words: where it comes from, when it is due. */
export function why(item: DayItem): string {
  const source = item.source ?? '';
  switch (item.kind) {
    case 'decision':
      return m.today_why_decision({ source });
    case 'draft':
      return m.today_why_draft({ source });
    case 'app_task':
      return item.dueAt
        ? m.today_why_app_task_due({ source, date: dayOf(item.dueAt) })
        : m.today_why_app_task({ source });
    case 'form':
      return m.today_why_form({
        done: String(item.progress?.done ?? 0),
        total: String(item.progress?.total ?? 0),
        date: item.dueAt ? dayOf(item.dueAt) : '—',
      });
    case 'action':
      return m.today_why_action({ date: item.dueAt ? dayOf(item.dueAt) : '—' });
    case 'note':
      return m.today_why_note();
  }
}
