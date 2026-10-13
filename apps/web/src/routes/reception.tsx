import { Button, PageHeader, PageSection, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal, Select } from '@/lib/forms';
import {
  changeReception,
  fetchReception,
  tryReception,
  type ReceptionChange,
  type ReceptionTrial,
} from '@/lib/reception';
import { fetchOwnAgents } from '@/lib/requests';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/mon-accueil')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async () => {
    const [reception, agents] = await Promise.all([fetchReception(), fetchOwnAgents()]);
    return { reception, agents };
  },
  component: ReceptionPage,
});

const dayWords = (day: string) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

function trialWords(trial: ReceptionTrial): string {
  switch (trial.handledBy.kind) {
    case 'agent':
      return m.reception_trial_agent({ name: trial.handledBy.name, word: trial.handledBy.word });
    case 'away':
      return m.reception_trial_away({
        name: trial.handledBy.name,
        until: dayWords(trial.handledBy.until),
      });
    case 'me':
      return m.reception_trial_me();
  }
}

/**
 * « Mon accueil » (spec 067, doctrine D-044): what arrives at her and who takes care of it. With
 * nothing set, everything arrives at her. A rule hands the requests that speak of a word to one of
 * her own agents, which prepares — she still signs. Away, her requests go to a colleague.
 */
function ReceptionPage() {
  const { me } = Route.useRouteContext();
  const { reception, agents } = Route.useLoaderData();
  const router = useRouter();
  const [words, setWords] = useState('');
  const [agentId, setAgentId] = useState('');
  const [away, setAway] = useState({ startsOn: '', endsOn: '', colleague: '' });
  const [asked, setAsked] = useState('');
  const [trial, setTrial] = useState<ReceptionTrial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chosen = agentId || agents[0]?.agentId || '';

  async function change(data: ReceptionChange): Promise<boolean> {
    setPending(true);
    setError(null);
    const answer = await changeReception({ data });
    setPending(false);
    if (!answer.ok) {
      setError(refusal(answer.error));
      return false;
    }
    setTrial(null);
    await router.invalidate();
    return true;
  }

  return (
    <AppShell me={me} current="reception">
      <PageHeader title={m.nav_reception()} description={m.reception_explain()} />
      <PageSection title={m.reception_rules()}>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body-sm">
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th className="py-2 pe-3 text-start font-semibold">{m.reception_when()}</th>
                <th className="py-2 pe-3 text-start font-semibold">{m.reception_who()}</th>
                <th className="py-2 pe-3 text-start font-semibold">{m.reception_back()}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reception.rules.map((rule) => (
                <tr key={rule.ruleId}>
                  <td className="py-2 pe-3">{rule.words.join(', ')}</td>
                  <td className="py-2 pe-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <Tag tone="agent">{rule.agent.name}</Tag>
                      {m.reception_prepares()}
                      {!rule.applies && <Tag tone="neutral">{m.reception_rule_idle()}</Tag>}
                    </span>
                  </td>
                  <td className="py-2 pe-3">{m.reception_i_sign()}</td>
                  <td className="py-2 text-end">
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void change({ kind: 'remove', ruleId: rule.ruleId })}
                    >
                      {m.reception_remove()}
                    </Button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pe-3">
                  {reception.rules.length > 0 ? m.reception_rest() : m.reception_everything()}
                </td>
                <td className="py-2 pe-3">{m.reception_me()}</td>
                <td className="py-2 pe-3">{m.reception_me()}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-body-sm text-fg-muted">{m.reception_safeguards()}</p>
      </PageSection>
      <PageSection title={m.reception_add_rule()}>
        {agents.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            {m.reception_no_agent()}{' '}
            <a href="/mes-agents" className="font-semibold text-link underline">
              {m.nav_my_agents()}
            </a>
          </p>
        ) : (
          <form
            className="grid gap-3 md:max-w-xl"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await change({ kind: 'rule', words, agentId: chosen })) {
                setWords('');
              }
            }}
          >
            <TextField
              label={m.reception_words()}
              hint={m.reception_words_hint()}
              value={words}
              maxLength={600}
              onChange={(event) => setWords(event.target.value)}
              required
            />
            <Select
              label={m.reception_agent()}
              value={chosen}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.name}
                </option>
              ))}
            </Select>
            <div>
              <Button type="submit" disabled={pending || words.trim().length < 2}>
                {m.reception_add()}
              </Button>
            </div>
          </form>
        )}
      </PageSection>
      <PageSection title={m.reception_away()}>
        {reception.absence ? (
          <div className="grid gap-3">
            <p>
              {m.reception_away_set({
                from: dayWords(reception.absence.startsOn),
                to: dayWords(reception.absence.endsOn),
                name: reception.absence.delegate.name,
              })}
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => void change({ kind: 'back' })}
              >
                {m.reception_away_clear()}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="grid gap-3 md:max-w-xl"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await change({ kind: 'absence', ...away })) {
                setAway({ startsOn: '', endsOn: '', colleague: '' });
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                type="date"
                label={m.reception_away_from()}
                value={away.startsOn}
                onChange={(event) => setAway({ ...away, startsOn: event.target.value })}
                required
              />
              <TextField
                type="date"
                label={m.reception_away_to()}
                value={away.endsOn}
                onChange={(event) => setAway({ ...away, endsOn: event.target.value })}
                required
              />
            </div>
            <TextField
              label={m.reception_away_colleague()}
              hint={m.requests_colleague_hint()}
              value={away.colleague}
              onChange={(event) => setAway({ ...away, colleague: event.target.value })}
              required
            />
            <div>
              <Button
                type="submit"
                disabled={pending || !away.startsOn || !away.endsOn || !away.colleague.trim()}
              >
                {m.reception_away_save()}
              </Button>
            </div>
          </form>
        )}
      </PageSection>
      <PageSection title={m.reception_try()}>
        <form
          className="grid gap-3 md:max-w-xl"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            const answer = await tryReception({ data: { title: asked } });
            if (answer.ok) setTrial(answer.data.trial);
            else setError(refusal(answer.error));
          }}
        >
          <TextField
            label={m.reception_try_label()}
            value={asked}
            maxLength={200}
            onChange={(event) => {
              setAsked(event.target.value);
              setTrial(null);
            }}
            required
          />
          <div>
            <Button type="submit" variant="secondary" disabled={!asked.trim()}>
              {m.reception_try_button()}
            </Button>
          </div>
          {trial && (
            <p role="status" className="rounded-box border border-line bg-surface-muted p-3">
              {trialWords(trial)} {m.reception_trial_signed()}
            </p>
          )}
        </form>
      </PageSection>
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </AppShell>
  );
}
