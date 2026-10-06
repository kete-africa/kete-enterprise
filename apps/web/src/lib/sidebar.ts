import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { sendGesture, type GestureAnswer } from '@/platform/api';

// The sidebar the person arranges (spec 049), as the API keeps it.

export const shortcutKinds = [
  'place',
  'dashboard',
  'dossier',
  'agent',
  'conversation',
  'app',
  'link',
] as const;
export type ShortcutKind = (typeof shortcutKinds)[number];
export interface Shortcut {
  kind: ShortcutKind;
  ref: string;
  label: string;
}
export interface SidebarLayout {
  hidden: string[];
  sections: { name: string | null; items: Shortcut[] }[];
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const kindOf = (value: unknown): ShortcutKind => {
  const kind = shortcutKinds.find((k) => k === value);
  if (!kind) throw new Error('Which kind of shortcut?');
  return kind;
};
const shortcutOf = (value: unknown): Shortcut => {
  const v = (value ?? {}) as Record<string, unknown>;
  return { kind: kindOf(v.kind), ref: text(v.ref, 200), label: text(v.label, 120) };
};
const layoutOf = (value: unknown): SidebarLayout => {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    hidden: (Array.isArray(v.hidden) ? v.hidden : [])
      .filter((h): h is string => typeof h === 'string')
      .slice(0, 30),
    sections: (Array.isArray(v.sections) ? v.sections : []).slice(0, 8).map((raw) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const name = text(s.name, 40);
      return {
        name: name || null,
        items: (Array.isArray(s.items) ? s.items : []).slice(0, 30).map(shortcutOf),
      };
    }),
  };
};

type Answer = GestureAnswer<{ layout: SidebarLayout }>;

/** She pins a shortcut in her sidebar's first section. */
export const pinShortcut = createServerFn({ method: 'POST' })
  .validator(shortcutOf)
  .handler(async ({ data }): Promise<Answer> =>
    sendGesture(getRequest(), '/v1/sidebar/pin', data, crypto.randomUUID()),
  );

/** She removes a shortcut from her sidebar. */
export const unpinShortcut = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const v = (input ?? {}) as Record<string, unknown>;
    return { kind: kindOf(v.kind), ref: text(v.ref, 200) };
  })
  .handler(async ({ data }): Promise<Answer> =>
    sendGesture(getRequest(), '/v1/sidebar/unpin', data, crypto.randomUUID()),
  );

/** She keeps her sidebar as she arranged it. */
export const arrangeSidebar = createServerFn({ method: 'POST' })
  .validator(layoutOf)
  .handler(async ({ data }): Promise<Answer> =>
    sendGesture(getRequest(), '/v1/sidebar/arrange', { layout: data }, crypto.randomUUID()),
  );

/** Back to the sidebar Kete proposes. */
export const resetSidebar = createServerFn({ method: 'POST' }).handler(async (): Promise<Answer> =>
  sendGesture(getRequest(), '/v1/sidebar/reset', {}, crypto.randomUUID()),
);
