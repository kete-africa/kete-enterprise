import { Button, PageHeader, PageSection, Tag, TextField, type TagTone } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal, Select } from '@/lib/forms';
import { permissionLabel } from '@/lib/rights-view';
import {
  createRule,
  fetchRules,
  setRuleState,
  simulateRule,
  type Rule,
  type RuleFamily,
  type RuleState,
  type Simulation,
} from '@/lib/rules';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

export const Route = createFileRoute('/administration/regles')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    if (!context.me.administrator) throw redirect({ to: '/administration' });
    return context;
  },
  loader: () => fetchRules(),
  component: RulesPage,
});

const familyWords: Record<RuleFamily, () => string> = {
  data: m.rule_family_data,
  models: m.rule_family_models,
  tools: m.rule_family_tools,
  autonomy: m.rule_family_autonomy,
  retention: m.rule_family_retention,
  transparency: m.rule_family_transparency,
  budgets: m.rule_family_budgets,
  exit: m.rule_family_exit,
};
const stateWords: Record<RuleState, () => string> = {
  trial: m.rule_state_trial,
  active: m.rule_state_active,
  off: m.rule_state_off,
};
const stateTone: Record<RuleState, TagTone> = {
  trial: 'verify',
  active: 'validated',
  off: 'neutral',
};
const when = (iso: string) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** One rule: its sentence, its state, what it did last month — and its gestures. */
function RuleRow({ rule }: { rule: Rule }) {
  const router = useRouter();
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function move(state: RuleState) {
    setPending(true);
    setError(null);
    const answer = await setRuleState({ data: { ruleId: rule.ruleId, state } });
    setPending(false);
    if (!answer.ok) return setError(refusal(answer.error));
    await router.invalidate();
  }
  async function tryIt() {
    setPending(true);
    setError(null);
    const answer = await simulateRule({ data: { ruleId: rule.ruleId } });
    setPending(false);
    if (!answer.ok) return setError(refusal(answer.error));
    setSimulation(answer.data.simulation);
    await router.invalidate();
  }

  return (
    <li className="grid gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={stateTone[rule.state]}>{stateWords[rule.state]()}</Tag>
        <Tag>{familyWords[rule.family]()}</Tag>
        <span className="min-w-0 flex-1 basis-72 font-semibold">{rule.sentence}</span>
      </div>
      <p className="text-body-sm text-fg-muted">
        {rule.effect === 'forbid' ? m.rule_effect_forbid() : m.rule_effect_person()}{' '}
        {rule.permissions.length > 0
          ? rule.permissions.map((p) => permissionLabel(p)).join(', ')
          : m.rule_everything()}
        {' · '}
        {m.rule_last_month({
          refused: String(rule.lastMonth.refused),
          counted: String(rule.lastMonth.counted),
        })}
      </p>
      {simulation && (
        <div
          role="status"
          className="grid gap-1 rounded-box border border-line bg-surface-muted p-3"
        >
          <p>
            {m.rule_simulation({
              refused: String(simulation.refused),
              steps: String(simulation.steps),
              days: String(simulation.days),
            })}
          </p>
          {simulation.examples.length > 0 && (
            <ul className="grid gap-1 text-body-sm text-fg-muted">
              {simulation.examples.map((example, index) => (
                <li key={index}>
                  {example.agent} · {example.tool} · {when(example.at)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {rule.state !== 'off' && (
          <Button variant="secondary" disabled={pending} onClick={() => void tryIt()}>
            {m.rule_try()}
          </Button>
        )}
        {rule.state === 'trial' && (
          <Button disabled={pending || !rule.simulatedAt} onClick={() => void move('active')}>
            {m.rule_switch_on()}
          </Button>
        )}
        {rule.state === 'active' && (
          <Button variant="secondary" disabled={pending} onClick={() => void move('trial')}>
            {m.rule_back_to_trial()}
          </Button>
        )}
        {rule.state !== 'off' ? (
          <Button variant="secondary" disabled={pending} onClick={() => void move('off')}>
            {m.rule_switch_off()}
          </Button>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={() => void move('trial')}>
            {m.rule_back_to_trial()}
          </Button>
        )}
      </div>
      {rule.state === 'trial' && !rule.simulatedAt && (
        <p className="text-body-sm text-fg-muted">{m.rule_try_first()}</p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-state-error-fg">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The rules of the organization for its agents (spec 068, doctrine D-043): each a sentence, born
 * on trial, tried on the last month, then switched on. Below, what they refused — the evidence.
 */
function RulesPage() {
  const { me } = Route.useRouteContext();
  const screen = Route.useLoaderData();
  const router = useRouter();
  const applied = screen.families.filter((family) => family.applied).map((f) => f.family);
  const later = screen.families.filter((family) => !family.applied).map((f) => f.family);
  const [family, setFamily] = useState<RuleFamily>(applied[0] ?? 'tools');
  const [sentence, setSentence] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const active = screen.rules.filter((rule) => rule.state === 'active').length;
  const onTrial = screen.rules.filter((rule) => rule.state === 'trial').length;

  return (
    <AppShell me={me} current="rules">
      <PageHeader
        breadcrumbLabel={m.common_breadcrumb()}
        breadcrumbs={[{ label: m.nav_administration(), href: '/administration' }]}
        title={m.nav_rules()}
        description={m.rules_explain()}
        status={<Tag>{m.rules_count({ active: String(active), trial: String(onTrial) })}</Tag>}
      />
      <PageSection first title={m.rules_list()}>
        {screen.rules.length === 0 ? (
          <p className="text-fg-muted">{m.rules_none()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {screen.rules.map((rule) => (
              <RuleRow key={rule.ruleId} rule={rule} />
            ))}
          </ul>
        )}
      </PageSection>
      <PageSection title={m.rules_new()}>
        <form
          className="grid gap-3 md:max-w-2xl"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const answer = await createRule({ data: { family, sentence, permissions } });
            setPending(false);
            if (!answer.ok) return setError(refusal(answer.error));
            setSentence('');
            setPermissions([]);
            await router.invalidate();
          }}
        >
          <Select
            label={m.rules_family()}
            value={family}
            onChange={(event) => setFamily(event.target.value as RuleFamily)}
          >
            {applied.map((key) => (
              <option key={key} value={key}>
                {familyWords[key]()}
              </option>
            ))}
          </Select>
          <p className="text-body-sm text-fg-muted">
            {family === 'tools'
              ? m.rules_family_tools_explain()
              : m.rules_family_autonomy_explain()}
          </p>
          <TextField
            label={m.rules_sentence()}
            hint={m.rules_sentence_hint()}
            value={sentence}
            maxLength={300}
            onChange={(event) => setSentence(event.target.value)}
            required
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-body-sm font-semibold">
              {family === 'tools' ? m.rules_covers_required() : m.rules_covers_optional()}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {screen.permissions.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={permissions.includes(permission)}
                    onChange={(event) =>
                      setPermissions(
                        event.target.checked
                          ? [...permissions, permission]
                          : permissions.filter((p) => p !== permission),
                      )
                    }
                  />
                  {permissionLabel(permission)}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-body-sm text-state-error-fg">
              {error}
            </p>
          )}
          <div>
            <Button
              type="submit"
              disabled={
                pending ||
                sentence.trim().length < 3 ||
                (family === 'tools' && permissions.length === 0)
              }
            >
              {m.rules_create()}
            </Button>
          </div>
          <p className="text-body-sm text-fg-muted">
            {m.rules_later({ families: later.map((key) => familyWords[key]()).join(', ') })}
          </p>
        </form>
      </PageSection>
      <PageSection title={m.rules_evidence()}>
        {screen.refusals.length === 0 ? (
          <p className="text-fg-muted">{m.rules_no_refusal()}</p>
        ) : (
          <ul className="divide-y divide-line">
            {screen.refusals.map((entry) => (
              <li key={entry.refusalId} className="grid gap-1 py-3 text-body-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={entry.trial ? 'verify' : 'error'}>
                    {entry.trial ? m.rules_counted() : m.rules_refused()}
                  </Tag>
                  <span className="font-semibold">{entry.rule}</span>
                </div>
                <p className="text-fg-muted">
                  {[
                    entry.agentName ?? m.rules_assistant(),
                    entry.tool,
                    permissionLabel(entry.permission),
                    when(entry.at),
                  ].join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </AppShell>
  );
}
