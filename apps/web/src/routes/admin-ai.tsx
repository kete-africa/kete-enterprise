import { Button, PageSection, PageHeader, Panel, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchUsage, setBudget } from '@/lib/workspace';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/administration/ia')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchUsage(),
  component: AiPage,
});

/**
 * The organization's use of models (spec 014): which model, how much this month by purpose, and
 * the monthly budget past which no call is made. The model is chosen by the instance's environment,
 * never from a screen; its key never shows.
 */
function AiPage() {
  const { me } = Route.useRouteContext();
  const usage = Route.useLoaderData();
  const router = useRouter();
  const [budget, setDraft] = useState(
    usage.monthlyTokens === null ? '' : String(usage.monthlyTokens),
  );
  const [error, setError] = useState<string | null>(null);
  const total = usage.purposes.reduce((s, p) => s + p.tokens, 0);
  return (
    <AppShell me={me} current="ai">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_ai()}
      />
      <PageSection first title={m.ai_model()}>
        <Panel>
          <p>
            {usage.model
              ? m.ai_model_is({ provider: usage.provider ?? '', model: usage.model })
              : m.ai_no_model()}
          </p>
          <p className="mt-2 text-body-sm text-fg-muted">{m.ai_model_explain()}</p>
        </Panel>
      </PageSection>
      <PageSection title={m.ai_usage({ tokens: total.toLocaleString() })}>
        <Panel>
          <ul className="grid gap-1 text-body-sm">
            {usage.purposes.map((p) => (
              <li key={p.purpose} className="flex justify-between gap-3">
                <span>
                  {p.purpose === 'chat'
                    ? m.ai_purpose_chat()
                    : p.purpose === 'briefing'
                      ? m.ai_purpose_briefing()
                      : p.purpose}
                </span>
                <span className="font-number">
                  {m.ai_purpose_line({ calls: String(p.calls), tokens: p.tokens.toLocaleString() })}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </PageSection>
      <PageSection title={m.ai_budget()}>
        <Panel>
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              label={m.ai_budget_tokens()}
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              disabled={budget === ''}
              onClick={() => {
                setError(null);
                void setBudget({ data: { monthlyTokens: Number(budget) } }).then(async (answer) => {
                  if (!answer.ok) return setError(refusal(answer.error));
                  await router.invalidate();
                });
              }}
            >
              {m.form_save()}
            </Button>
          </div>
          <p className="mt-2 text-body-sm text-fg-muted">{m.ai_budget_explain()}</p>
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
        </Panel>
      </PageSection>
    </AppShell>
  );
}
