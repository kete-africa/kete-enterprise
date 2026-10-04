import { Button, EmptyState, PageHeader, Row, RowList } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { addMemory, fetchMemories, forgetMemory } from '@/lib/memory';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/assistant/memoire')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchMemories(),
  component: MemoryPage,
});

/** What her assistant remembers about her (spec 029): shown to her only, forgotten on demand. */
function MemoryPage() {
  const { me } = Route.useRouteContext();
  const { memories } = Route.useLoaderData();
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gesture = (work: () => Promise<{ ok: boolean; error: string | null }>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(async (answer) => {
        if (!answer.ok) setError(refusal(answer.error));
        await router.invalidate();
      })
      .catch(() => setError(m.error_generic()))
      .finally(() => setBusy(false));
  };
  return (
    <AppShell me={me} current="assistant">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_assistant(), href: '/assistant' }]}
        title={m.memory_title()}
        description={m.memory_explain()}
      />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length < 3) return;
          gesture(async () => {
            const answer = await addMemory({ data: { text } });
            if (answer.ok) setText('');
            return answer;
          });
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-body-sm font-semibold">
          {m.memory_new()}
          <input
            className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal text-fg"
            value={text}
            maxLength={300}
            placeholder={m.memory_add_hint()}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy || text.trim().length < 3}>
          {m.memory_add()}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-state-error-fg">
          {error}
        </p>
      )}
      {memories.length === 0 ? (
        <EmptyState title={m.memory_none()} />
      ) : (
        <RowList label={m.memory_title()}>
          {memories.map((x) => (
            <Row
              key={x.memoryId}
              title={x.text}
              {...(x.origin === 'assistant' ? { meta: m.memory_by_assistant() } : {})}
              end={
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => gesture(() => forgetMemory({ data: { memoryId: x.memoryId } }))}
                >
                  {m.memory_forget()}
                </Button>
              }
            />
          ))}
        </RowList>
      )}
    </AppShell>
  );
}
