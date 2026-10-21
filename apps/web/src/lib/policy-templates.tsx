import { Button, Tag } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { savePolicy, simulateTemplate, type PolicyTemplate, type Simulated } from '@/lib/policies';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

// The six policies in plain forms (spec 098, FR-019; doctrine D-058): she chooses a sentence, fills
// its blanks, sees what it would have decided over the last 30 days, then puts it on trial —
// observed, never enforced, until she turns it on.

const families: Record<PolicyTemplate['family'], () => string> = {
  commits: m.policy_family_commits,
  speaks: m.policy_family_speaks,
  spending: m.policy_family_spending,
  deputies: m.policy_family_deputies,
  retention: m.policy_family_retention,
  consent: m.policy_family_consent,
};
const approvers = [
  ['manager', m.policy_approver_manager],
  ['direction', m.policy_approver_direction],
  ['project.holder', m.policy_approver_project],
] as const;
const channels = [
  ['whatsapp', m.threads_via_whatsapp],
  ['mail', m.threads_via_mail],
  ['telegram', m.threads_via_telegram],
] as const;
const effect: Record<string, () => string> = {
  allow: m.policy_effect_allow,
  approve: m.policy_effect_approve,
  refuse: m.policy_effect_refuse,
};

const field =
  'h-(--control-height) rounded-control border border-line-control bg-control px-2 text-body-sm';

export function PolicyTemplates({ templates }: { templates: PolicyTemplate[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<PolicyTemplate | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({
    amount: 1_000_000,
    approver: 'direction',
    channels: ['whatsapp', 'mail'],
    from: 8,
    to: 19,
    days: 3650,
  });
  const [seen, setSeen] = useState<Simulated | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSeen(null);
  };
  const filled = () =>
    Object.fromEntries((chosen?.blanks ?? []).map((blank) => [blank, values[blank]]));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(families).map(([family, label]) => {
          const list = templates.filter((t) => t.family === family);
          if (list.length === 0) return null;
          return (
            <section
              key={family}
              className="grid gap-1.5 rounded-box border border-line bg-surface p-3"
            >
              <h3 className="text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
                {label()}
              </h3>
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={chosen?.id === t.id}
                  onClick={() => {
                    setChosen(t);
                    setSeen(null);
                    setNote(null);
                  }}
                  className="rounded-control px-2 py-1 text-left text-body-sm hover:bg-surface-hover aria-pressed:bg-surface-selected aria-pressed:font-semibold"
                >
                  {t.example}
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {chosen && (
        <section className="grid gap-3 rounded-box border border-accent bg-surface p-4">
          <p className="font-semibold">{chosen.example}</p>
          {chosen.blanks.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 text-body-sm">
              {chosen.blanks.includes('amount') && (
                <label className="grid gap-1">
                  {m.policy_blank_amount()}
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={Number(values.amount)}
                    onChange={(e) => set('amount', Number(e.target.value))}
                    className={field}
                  />
                </label>
              )}
              {chosen.blanks.includes('approver') && (
                <label className="grid gap-1">
                  {m.policy_blank_approver()}
                  <select
                    value={String(values.approver)}
                    onChange={(e) => set('approver', e.target.value)}
                    className={field}
                  >
                    {approvers.map(([value, word]) => (
                      <option key={value} value={value}>
                        {word()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {chosen.blanks.includes('channels') && (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1">{m.policy_blank_channels()}</legend>
                  {channels.map(([value, word]) => (
                    <label key={value} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={(values.channels as string[]).includes(value)}
                        onChange={(e) =>
                          set(
                            'channels',
                            e.target.checked
                              ? [...(values.channels as string[]), value]
                              : (values.channels as string[]).filter((c) => c !== value),
                          )
                        }
                      />
                      {word()}
                    </label>
                  ))}
                </fieldset>
              )}
              {chosen.blanks.includes('from') && (
                <label className="grid gap-1">
                  {m.policy_blank_hours()}
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={Number(values.from)}
                      onChange={(e) => set('from', Number(e.target.value))}
                      className={`${field} w-20`}
                    />
                    –
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={Number(values.to)}
                      onChange={(e) => set('to', Number(e.target.value))}
                      className={`${field} w-20`}
                    />
                  </span>
                </label>
              )}
              {chosen.blanks.includes('days') && (
                <label className="grid gap-1">
                  {m.policy_blank_days()}
                  <input
                    type="number"
                    min={1}
                    value={Number(values.days)}
                    onChange={(e) => set('days', Number(e.target.value))}
                    className={field}
                  />
                </label>
              )}
            </div>
          )}
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setNote(null);
                void simulateTemplate({ data: { templateId: chosen.id, values: filled() } })
                  .then((answer) =>
                    answer.ok ? setSeen(answer.data) : setNote(refusal(answer.error)),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {m.policy_simulate()}
            </Button>
            {seen && (
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void savePolicy({
                    data: {
                      id: seen.policy.id,
                      sentence: seen.policy.sentence,
                      rule: seen.policy.rule,
                      set: seen.policy.set,
                      ...(seen.policy.approver ? { approver: seen.policy.approver } : {}),
                    },
                  })
                    .then(async (answer) => {
                      if (!answer.ok) return setNote(refusal(answer.error));
                      setNote(m.policy_on_trial());
                      setChosen(null);
                      setSeen(null);
                      await router.invalidate();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {m.policy_put_on_trial()}
              </Button>
            )}
          </span>
          {seen && (
            <div className="grid gap-2 text-body-sm">
              <p className="font-semibold">« {seen.policy.sentence} »</p>
              <p>
                {seen.simulation.total === 0
                  ? m.policy_simulation_none({ count: String(seen.simulation.replayed) })
                  : m.policy_simulation_some({
                      count: String(seen.simulation.total),
                      replayed: String(seen.simulation.replayed),
                    })}
              </p>
              {seen.simulation.changed.length > 0 && (
                <ul className="grid gap-1">
                  {seen.simulation.changed.map((c) => (
                    <li key={`${c.at}-${c.kind}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-fg-muted">
                        {new Intl.DateTimeFormat(getLocale(), {
                          day: 'numeric',
                          month: 'short',
                        }).format(new Date(c.at))}
                      </span>
                      <span>{c.kind}</span>
                      {c.amount && (
                        <span className="font-mono">
                          {new Intl.NumberFormat(getLocale(), {
                            style: 'currency',
                            currency: c.amount.currency,
                            maximumFractionDigits: 0,
                          }).format(c.amount.value)}
                        </span>
                      )}
                      <Tag tone="info">{effect[c.before]?.() ?? c.before}</Tag>→
                      <Tag tone="verify">{effect[c.after]?.() ?? c.after}</Tag>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {note && <p className="text-body-sm text-fg-muted">{note}</p>}
        </section>
      )}
      {!chosen && note && <p className="text-body-sm text-fg-muted">{note}</p>}
    </div>
  );
}
