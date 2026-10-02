import { Button, PageSection, PageTitle, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchPeople } from '@/lib/admin';
import { refusal, Select } from '@/lib/forms';
import { opens } from '@/lib/me';
import { fetchQuarter, percent, performanceGesture } from '@/lib/performance';
import { colourTag, quarterStatusLabel, reviewStatusLabel } from '@/lib/review-view';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/performance/$quarterId')({
  beforeLoad: async ({ location }) => {
    const context = await requirePerson(location.href);
    const tools = [
      'performance:manage',
      'performance:measure',
      'performance:validate',
      'performance:read',
    ];
    if (!opens(context.me, 'performance', tools)) throw redirect({ to: '/' });
    return context;
  },
  loader: async ({ params }) => {
    const [screen, chart] = await Promise.all([
      fetchQuarter({ data: { quarterId: params.quarterId } }),
      fetchPeople(),
    ]);
    return { ...screen, chart };
  },
  component: QuarterPage,
});

/** One quarter: its gestures, its collective factors, and every review with its colours. */
function QuarterPage() {
  const { me } = Route.useRouteContext();
  const { quarter, reviews, chart } = Route.useLoaderData();
  const router = useRouter();
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [unit, setUnit] = useState({ unitId: '', factor: '' });
  const [group, setGroup] = useState({
    factor: quarter.groupFactor === null ? '' : String(Math.round(quarter.groupFactor * 100)),
    triggered: quarter.groupTriggered,
  });
  const can = (p: string) => me.administrator || me.permissions.includes(p);
  const act = (path: string, body: object, done: (d: Record<string, unknown>) => string) => {
    setNotice(null);
    void performanceGesture({ data: { path, body, key: crypto.randomUUID() } }).then(
      async (answer) => {
        if (!answer.ok) return setNotice({ tone: 'error', text: refusal(answer.error) });
        setNotice({ tone: 'ok', text: done(answer.data ?? {}) });
        await router.invalidate();
      },
    );
  };
  const base = `/quarters/${quarter.quarterId}`;
  const unitName = new Map(chart.units.map((u) => [u.unitId, u.name]));
  const reds = (r: (typeof reviews)[number]) => r.lines.filter((l) => l.colour === 'red').length;
  return (
    <AppShell me={me} current="performance">
      <PageTitle>{quarter.label}</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={quarter.status === 'open' ? 'info' : 'neutral'}>
          {quarterStatusLabel(quarter.status)}
        </Tag>
        <span className="text-body-sm text-fg-muted">
          {m.surveys_dates({ opens: quarter.startsOn, closes: quarter.endsOn })}
        </span>
        <span className="text-body-sm text-fg-muted">
          {m.quarter_scale({
            green: percent(quarter.scale.green),
            orange: percent(quarter.scale.orange),
            red: percent(quarter.scale.red),
          })}
        </span>
      </div>
      <PageSection first title={m.campaign_gestures()}>
        <div className="flex flex-wrap gap-3">
          {quarter.status === 'draft' && can('performance:manage') && (
            <Button
              onClick={() =>
                act(`${base}/open`, {}, (d) =>
                  m.quarter_opened({
                    reviews: String(d.reviews ?? 0),
                    sent: String(d.sent ?? 0),
                    relayed: String(d.relayed ?? 0),
                  }),
                )
              }
            >
              {m.quarter_open_action()}
            </Button>
          )}
          {quarter.status === 'open' && can('performance:measure') && (
            <Button
              onClick={() =>
                act(`${base}/close-measures`, {}, (d) =>
                  m.quarter_measures_closed({ missing: String(d.missing ?? 0) }),
                )
              }
            >
              {m.quarter_close_measures()}
            </Button>
          )}
          {quarter.status === 'measured' && can('performance:manage') && (
            <Button
              variant="secondary"
              onClick={() =>
                act(`${base}/close`, {}, (d) =>
                  m.quarter_closed_done({ missed: String(d.missed ?? 0) }),
                )
              }
            >
              {m.quarter_close_action()}
            </Button>
          )}
        </div>
        {notice && (
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`mt-3 text-body-sm ${notice.tone === 'error' ? 'text-state-error-fg' : 'text-state-success-fg'}`}
          >
            {notice.text}
          </p>
        )}
      </PageSection>
      {quarter.status !== 'draft' && can('performance:measure') && (
        <PageSection title={m.quarter_collective()}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={m.quarter_units()}>
              <ul className="mb-3 grid gap-1 text-body-sm">
                {quarter.units.map((u) => (
                  <li key={u.unitId} className="flex justify-between gap-3">
                    <span>{unitName.get(u.unitId)}</span>
                    <span className="font-number">{percent(u.factor)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label={m.field_unit()}
                  value={unit.unitId}
                  onChange={(e) => setUnit({ ...unit, unitId: e.target.value })}
                >
                  <option value="">{m.field_choose()}</option>
                  {chart.units.map((u) => (
                    <option key={u.unitId} value={u.unitId}>
                      {u.name}
                    </option>
                  ))}
                </Select>
                <TextField
                  className="w-28"
                  label={m.quarter_factor_percent()}
                  type="number"
                  min={0}
                  max={100}
                  value={unit.factor}
                  onChange={(e) => setUnit({ ...unit, factor: e.target.value })}
                />
                <Button
                  disabled={!unit.unitId || unit.factor === ''}
                  onClick={() =>
                    act(`${base}/units/${unit.unitId}`, { factor: Number(unit.factor) / 100 }, () =>
                      m.quarter_factor_saved(),
                    )
                  }
                >
                  {m.form_save()}
                </Button>
              </div>
            </Panel>
            <Panel title={m.quarter_group()}>
              <div className="flex flex-wrap items-end gap-3">
                <TextField
                  className="w-28"
                  label={m.quarter_factor_percent()}
                  type="number"
                  min={0}
                  max={100}
                  value={group.factor}
                  onChange={(e) => setGroup({ ...group, factor: e.target.value })}
                />
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={group.triggered}
                    onChange={(e) => setGroup({ ...group, triggered: e.target.checked })}
                  />
                  {m.quarter_triggered()}
                </label>
                <Button
                  disabled={group.factor === ''}
                  onClick={() =>
                    act(
                      `${base}/group`,
                      { factor: Number(group.factor) / 100, triggered: group.triggered },
                      () => m.quarter_factor_saved(),
                    )
                  }
                >
                  {m.form_save()}
                </Button>
              </div>
            </Panel>
          </div>
        </PageSection>
      )}
      <PageSection title={m.quarter_reviews({ count: String(reviews.length) })}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-body-sm">
            <thead className="text-fg-muted">
              <tr>
                <th className="py-2">{m.field_person()}</th>
                <th>{m.field_position()}</th>
                <th>{m.review_status()}</th>
                <th>{m.review_reds()}</th>
                <th>{m.factor_individual_short()}</th>
                <th>{m.factor_total()}</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.reviewId} className="border-t border-line">
                  <td className="py-2">
                    <a
                      className="font-semibold text-link underline"
                      href={`/performance/revues/${r.reviewId}`}
                    >
                      {r.personName}
                    </a>
                  </td>
                  <td>{r.positionTitle}</td>
                  <td>
                    <Tag
                      tone={
                        r.status === 'validated'
                          ? 'validated'
                          : r.status === 'missed'
                            ? 'error'
                            : 'neutral'
                      }
                    >
                      {reviewStatusLabel(r.status)}
                    </Tag>
                  </td>
                  <td>
                    {reds(r) > 0 ? colourTag('red') : null} {reds(r) > 0 ? reds(r) : ''}
                  </td>
                  <td className="font-number">{percent(r.individual)}</td>
                  <td className="font-number font-semibold">{percent(r.factor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>
    </AppShell>
  );
}
