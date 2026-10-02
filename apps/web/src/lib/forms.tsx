import { Button, Panel } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import * as m from '@/paraglide/messages.js';

/** A refusal of the API, in the person's words. */
export function refusal(code: string | null): string {
  const messages: Record<string, () => string> = {
    forbidden: m.error_forbidden,
    cycle: m.error_cycle,
    closed: m.error_closed,
    primary_overlap: m.error_primary_overlap,
    ends_before_start: m.error_ends_before_start,
    not_found: m.error_not_found,
    invalid_input: m.error_invalid_input,
    duplicate: m.error_duplicate,
    unknown_permission: m.error_invalid_input,
    own_request: m.error_own_request,
    already_pending: m.error_already_pending,
    retired: m.error_retired,
    decided: m.error_decided,
    not_an_approver: m.error_not_an_approver,
    unknown_subject: m.error_unknown_subject,
    in_circuit: m.error_in_circuit,
    unknown_watch: m.error_unknown_watch,
    unknown_check: m.error_unknown_check,
    not_attested: m.error_not_attested,
    not_automatic: m.error_not_automatic,
    own_writing: m.error_own_writing,
    not_draft: m.error_not_draft,
    not_owner: m.error_not_owner,
    not_done: m.error_not_done,
    own_action: m.error_own_action,
    module_disabled: m.error_module_disabled,
    view_as_forbidden: m.error_view_as_forbidden,
    link_invalid: m.error_link_invalid,
  };
  return (messages[code ?? ''] ?? m.error_generic)();
}

export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-body-sm font-semibold text-fg">
      {label}
      <select
        className="h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal text-fg"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export type Send = (key: string) => Promise<{ ok: boolean; error: string | null }>;

/** One form, one gesture with its own idempotency key; then the page's data reloads. */
export function GestureForm({
  title,
  send,
  ready,
  onDone,
  children,
}: {
  title: string;
  send: Send;
  ready: boolean;
  onDone: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={title}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          send(crypto.randomUUID())
            .then(async (answer) => {
              if (!answer.ok) return setError(refusal(answer.error));
              onDone();
              await router.invalidate();
            })
            .catch(() => setError(m.error_generic()))
            .finally(() => setBusy(false));
        }}
      >
        {children}
        {error && (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !ready}>
          {m.form_save()}
        </Button>
      </form>
    </Panel>
  );
}

export const optional = (value: string) => (value.trim() ? value.trim() : undefined);
