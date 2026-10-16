import { useEffect, useRef, useSyncExternalStore } from 'react';

// What the page shows Kete Intelligence beside it (spec 048): it knows what she is looking at, and a
// page may ask it a question (spec 050). The drawer itself is lib/intelligence.tsx (spec 085).

/** What a page shows the assistant: its kind, its title, its address. */
export interface AssistantPage {
  kind: string;
  title: string;
  href: string;
}

// What the current page shows: one at a time, set by the page, read by the shell around it.
let shown: AssistantPage | null = null;
const listeners = new Set<() => void>();
const show = (page: AssistantPage | null) => {
  shown = page;
  for (const listener of listeners) listener();
};

/** A page says what it shows, for the assistant beside it. */
export function useAssistantPage(page: AssistantPage | null) {
  const key = page ? `${page.kind}|${page.title}|${page.href}` : '';
  const latest = useRef(page);
  latest.current = page;
  useEffect(() => {
    show(latest.current);
    return () => show(null);
  }, [key]);
}

// A page asks the assistant beside it (spec 050): the shell opens it with the question.
const askers = new Set<(question: string) => void>();
export function askBeside(question: string) {
  for (const ask of askers) ask(question);
}
/** The shell listens for a page's question. */
export function useAskBeside(ask: (question: string) => void) {
  useEffect(() => {
    askers.add(ask);
    return () => {
      askers.delete(ask);
    };
  }, [ask]);
}

/** What the page shows, for the shell. */
export function useShownPage(): AssistantPage | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => null,
  );
}
