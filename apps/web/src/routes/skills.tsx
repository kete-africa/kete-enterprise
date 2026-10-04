import { EmptyState, PageHeader, Tag } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { refusal } from '@/lib/forms';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import { fetchSkills, skillGesture, uploadSkill, type StoredSkill } from '@/lib/skills';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/competences')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchSkills(),
  component: SkillsPage,
});

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** The know-how the assistant reads (spec 031): the shipped skills and the organization's. */
function SkillsPage() {
  const { me } = Route.useRouteContext();
  const { manage, shipped, skills } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (
    work: () => Promise<{ ok: boolean; error: string | null; data?: unknown }>,
    done?: (data: unknown) => string,
  ) => {
    setBusy(true);
    setNotice(null);
    void work()
      .then(async (answer) => {
        setNotice(
          answer.ok
            ? done
              ? { ok: true, text: done(answer.data) }
              : null
            : { ok: false, text: refusal(answer.error) },
        );
        await router.invalidate();
      })
      .catch(() => setNotice({ ok: false, text: m.error_generic() }))
      .finally(() => setBusy(false));
  };
  const mine = (s: StoredSkill) => s.createdBy === me.userId;
  return (
    <AppShell me={me} current="skills">
      <PageHeader
        title={m.skills_title()}
        description={m.skills_explain()}
        actions={
          <>
            <label
              htmlFor="skill-zip"
              className="inline-flex h-(--control-height) cursor-pointer items-center rounded-control bg-primary px-(--control-padding) font-semibold text-on-primary"
            >
              {m.skills_upload()}
            </label>
            <input
              id="skill-zip"
              type="file"
              hidden
              accept=".zip,.skill,application/zip"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) run(async () => uploadSkill({ data: { data: await toBase64(file) } }));
              }}
            />
          </>
        }
      />
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? '' : 'text-state-error-fg'}>
          {notice.text}
        </p>
      )}
      <section className="grid gap-3">
        <h2 className="font-heading text-title font-semibold">{m.skills_kept()}</h2>
        {skills.length === 0 ? (
          <EmptyState title={m.skills_none()} />
        ) : (
          <ul className="grid gap-2">
            {skills.map((s) => (
              <li
                key={s.skillId}
                className="grid gap-2 rounded-box border border-line bg-surface p-4"
              >
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {s.name}
                  <Tag>
                    {s.audience.includes('everyone') ? m.skills_everyone() : m.skills_mine()}
                  </Tag>
                  {!s.enabled && <Tag>{m.skills_off()}</Tag>}
                </p>
                <p className="text-body-sm text-fg-muted">{s.description}</p>
                <div className="flex flex-wrap gap-3 text-body-sm font-semibold">
                  <a href={`/api/skills/${s.skillId}`} className="text-link underline">
                    {m.skills_download()}
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-link underline"
                    onClick={() =>
                      run(
                        () => skillGesture({ data: { skillId: s.skillId, action: 'evaluate' } }),
                        (data) => {
                          const report = (data as { report: { passed: number; total: number } })
                            .report;
                          return m.skills_report({ passed: report.passed, total: report.total });
                        },
                      )
                    }
                  >
                    {m.skills_evaluate()}
                  </button>
                  {manage && (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-link underline"
                      onClick={() =>
                        run(() =>
                          skillGesture({
                            data: {
                              skillId: s.skillId,
                              audience: s.audience.includes('everyone')
                                ? `user:${s.createdBy}`
                                : 'everyone',
                            },
                          }),
                        )
                      }
                    >
                      {s.audience.includes('everyone')
                        ? m.skills_keep_mine()
                        : m.skills_open_everyone()}
                    </button>
                  )}
                  {(manage || mine(s)) && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-link underline"
                        onClick={() =>
                          run(() =>
                            skillGesture({ data: { skillId: s.skillId, enabled: !s.enabled } }),
                          )
                        }
                      >
                        {s.enabled ? m.skills_switch_off() : m.skills_switch_on()}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-link underline"
                        onClick={() =>
                          run(() =>
                            skillGesture({ data: { skillId: s.skillId, action: 'remove' } }),
                          )
                        }
                      >
                        {m.skills_remove()}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-3">
        <h2 className="font-heading text-title font-semibold">{m.skills_shipped()}</h2>
        <ul className="grid gap-2">
          {shipped.map((s) => (
            <li key={s.name} className="rounded-box border border-line bg-surface p-4">
              <p className="font-semibold">{s.name}</p>
              <p className="text-body-sm text-fg-muted">{s.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
