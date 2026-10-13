import { Button, EmptyState } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import * as m from '@/paraglide/messages.js';

/**
 * What a person sees when a page could not be shown: in her language, saying that nothing changed,
 * with a way to try again and a way back to what waits for her — never the framework's own words.
 */
export function PageError() {
  const router = useRouter();
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center p-6">
      <EmptyState
        title={m.error_page_title()}
        action={
          <span className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => void router.invalidate()}>{m.error_page_retry()}</Button>
            <a
              href="/"
              className="inline-flex h-(--control-height) items-center rounded-control border border-line-control px-(--control-padding) font-semibold text-fg no-underline hover:bg-surface-hover"
            >
              {m.error_page_home()}
            </a>
          </span>
        }
      >
        {m.error_page_body()}
      </EmptyState>
    </main>
  );
}
