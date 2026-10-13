import { Tag } from '@kete/design';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import * as m from '@/paraglide/messages.js';
import { callApi } from '@/platform/api';
import { shownMoney } from './money';

// A project's money as the apps said it (spec 076, doctrine D-049): received, committed, spent,
// what is left of its funds — and each figure's pieces.

export interface ProjectMoney {
  projectId: string;
  currency: string;
  invoiced: number;
  received: number;
  committed: number;
  spent: number;
  available: number;
  short: number;
  outsideBudget: number;
  posts: { name: string; budget: number; committed: number; spent: number; left: number }[];
}

export interface MoneyLine {
  source: string;
  key: string;
  kind: 'invoiced' | 'received' | 'committed' | 'spent';
  amount: number;
  occurredOn: string;
  label: string;
  post: string | null;
  party: string | null;
  href: string | null;
}

/** A project's money; null when it is not hers to read — its lead's, or who reads all of it. */
export const fetchProjectMoney = createServerFn({ method: 'GET' })
  .validator((input: unknown) => {
    const id = (input as { projectId?: unknown } | null)?.projectId;
    if (typeof id !== 'string' || !/^prj_[0-9a-f-]{8,64}$/.test(id)) throw new Error('Unknown.');
    return { projectId: id };
  })
  .handler(({ data }) =>
    callApi<{ money: ProjectMoney; facts: MoneyLine[] }>(
      getRequest(),
      `/v1/money/projects/${data.projectId}`,
    ).catch(() => null),
  );

export interface FundsScreen {
  organization: {
    currency: string;
    reserved: number;
    committed: number;
    shortProjects: number;
    running: { invoiced: number; received: number; committed: number; spent: number };
  };
  projects: { projectId: string; name: string; status: string; money: ProjectMoney }[];
}

/** Every project's funds, for who reads the organization's money; null otherwise. */
export const fetchFunds = createServerFn({ method: 'GET' }).handler(() =>
  callApi<FundsScreen>(getRequest(), '/v1/money').catch(() => null),
);

const kindWords: Record<MoneyLine['kind'], () => string> = {
  invoiced: m.money_kind_invoiced,
  received: m.money_kind_received,
  committed: m.money_kind_committed,
  spent: m.money_kind_spent,
};

function Figure({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-body-sm text-fg-muted">{label}</p>
      <p className={`font-semibold tabular-nums ${alert ? 'text-state-error-fg' : ''}`}>{value}</p>
    </div>
  );
}

/** One post's bar: spent, then committed, on the scale of its budget — or of what exceeds it. */
function PostBar({ post, currency }: { post: ProjectMoney['posts'][number]; currency: string }) {
  const used = post.spent + post.committed;
  const scale = Math.max(post.budget, used, 1);
  const width = (amount: number) => `${((amount / scale) * 100).toFixed(1)}%`;
  return (
    <li className="grid gap-1 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{post.name}</span>
        <span className="text-body-sm tabular-nums text-fg-muted">
          {post.left >= 0
            ? m.money_post_left({
                used: shownMoney(used, currency),
                budget: shownMoney(post.budget, currency),
                left: shownMoney(post.left, currency),
              })
            : m.money_post_over({
                used: shownMoney(used, currency),
                budget: shownMoney(post.budget, currency),
                over: shownMoney(-post.left, currency),
              })}
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-pill bg-surface-hover" aria-hidden="true">
        <span className="bg-line-strong" style={{ width: width(post.spent) }} />
        <span
          className={post.left < 0 ? 'bg-state-error' : 'bg-state-verify'}
          style={{ width: width(post.committed) }}
        />
      </div>
    </li>
  );
}

/**
 * The money of a project: what it received, committed and spent, what is left of its funds, its
 * budget post by post, and the pieces behind each figure. Says when its commitments are about to
 * be paid with money received for something else.
 */
export function ProjectMoneyView({ money, facts }: { money: ProjectMoney; facts: MoneyLine[] }) {
  const show = (amount: number) => shownMoney(amount, money.currency);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label={m.money_received()} value={show(money.received)} />
        <Figure label={m.money_committed()} value={show(money.committed)} />
        <Figure label={m.money_spent()} value={show(money.spent)} />
        <Figure label={m.money_available()} value={show(money.available)} alert={money.short > 0} />
        <Figure label={m.money_invoiced()} value={show(money.invoiced)} />
      </div>
      {money.short > 0 && (
        <p role="status" className="rounded-box bg-state-error-surface p-3 text-state-error-fg">
          {money.available >= 0
            ? m.money_short_ahead({
                committed: show(money.committed),
                available: show(money.available),
                short: show(money.short),
              })
            : m.money_short_now({ short: show(money.short) })}
        </p>
      )}
      {money.posts.length > 0 && (
        <div>
          <ul className="divide-y divide-line">
            {money.posts.map((post) => (
              <PostBar key={post.name} post={post} currency={money.currency} />
            ))}
          </ul>
          <p className="mt-1 text-body-sm text-fg-muted">{m.money_bar_legend()}</p>
          {money.outsideBudget > 0 && (
            <p className="mt-1 text-body-sm text-state-verify-fg">
              {m.money_outside_budget({ amount: show(money.outsideBudget) })}
            </p>
          )}
        </div>
      )}
      {facts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-body-sm font-semibold">
            {m.money_pieces({ count: String(facts.length) })}
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {facts.map((fact) => (
              <li
                key={`${fact.source}:${fact.key}`}
                className="flex flex-wrap items-center gap-3 py-2 text-body-sm"
              >
                <Tag tone={fact.kind === 'spent' || fact.kind === 'committed' ? 'verify' : 'info'}>
                  {kindWords[fact.kind]()}
                </Tag>
                <span className="min-w-0 flex-1 basis-56">
                  {fact.href ? (
                    <a href={fact.href} className="text-link underline">
                      {fact.label}
                    </a>
                  ) : (
                    fact.label
                  )}
                  <span className="text-fg-muted">
                    {' · '}
                    {[fact.post, fact.party, fact.source, fact.occurredOn]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{show(fact.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
