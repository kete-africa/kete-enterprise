import { Button, Drawer } from '@kete/design';
import { useRouter } from '@tanstack/react-router';
import { useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
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
    pdf_unavailable: m.error_pdf_unavailable,
    pdf_failed: m.error_pdf_failed,
    template_invalid: m.error_template_invalid,
    skill_name_taken: m.error_skill_name_taken,
    skill_invalid: m.error_skill_invalid,
    no_cases: m.error_no_cases,
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
    used: m.error_used,
    not_open: m.error_not_open,
    not_closed: m.error_not_closed,
    submitted: m.error_submitted,
    incomplete: m.survey_incomplete,
    not_yours: m.error_not_yours,
    nobody: m.error_nobody,
    not_reviewer: m.error_not_reviewer,
    wrong_step: m.error_wrong_step,
    not_measured: m.error_not_measured,
    weights: m.error_weights,
    budget_spent: m.error_budget_spent,
    model_failed: m.error_model_failed,
    assistant_unavailable: m.assistant_unavailable,
    signed_out: m.error_signed_out,
    already_decided: m.error_decided,
    not_allowed: m.error_forbidden,
    factory_not_configured: m.error_factory_not_configured,
    factory_unreachable: m.error_factory_unreachable,
    invalid_key: m.error_invalid_key,
    provider_unreachable: m.error_provider_unreachable,
    personal_off: m.error_personal_off,
    unsupported_file: m.error_unsupported_file,
    file_too_large: m.error_file_too_large,
    unreadable_file: m.error_unreadable_file,
    secrets_off: m.ai_connection_unavailable,
    subscriptions_off: m.ai_subscription_unavailable,
    payer_refused: m.error_payer_refused,
    push_off: m.error_push_off,
    memory_full: m.error_memory_full,
    knowledge_unavailable: m.error_knowledge_unavailable,
    too_many_schedules: m.error_too_many_schedules,
    subscription_lost: m.error_subscription_lost,
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

/**
 * One gesture, one short form (spec 019): a button that opens the form in a dialog — on the right
 * when the screen is wide, centered otherwise — never beside the list it adds to. Its own
 * idempotency key; on success the dialog closes and the page's data reloads.
 */
export function GestureForm({
  title,
  send,
  ready,
  onDone,
  children,
  trigger = 'secondary',
}: {
  title: string;
  send: Send;
  ready: boolean;
  onDone: () => void;
  children: ReactNode;
  /** The look of the button that opens it: the page's main action, or a secondary one. */
  trigger?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setError(null);
  };
  return (
    <>
      <Button variant={trigger} onClick={() => setOpen(true)}>
        {title}
      </Button>
      <Drawer
        open={open}
        onClose={close}
        title={title}
        closeLabel={m.common_close()}
        footer={
          <>
            <Button type="submit" form={formId} disabled={busy || !ready}>
              {m.form_save()}
            </Button>
            <Button variant="secondary" onClick={close}>
              {m.common_cancel()}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            send(crypto.randomUUID())
              .then(async (answer) => {
                if (!answer.ok) return setError(refusal(answer.error));
                onDone();
                close();
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
        </form>
      </Drawer>
    </>
  );
}

export const optional = (value: string) => (value.trim() ? value.trim() : undefined);

/**
 * A short form of a page's own gesture (spec 019): a button that opens its fields in a dialog — on
 * the right when the screen is wide, centered otherwise — and sends it. The page tells the outcome.
 */
export function DialogForm({
  title,
  label,
  ready,
  busy = false,
  onSubmit,
  trigger = 'secondary',
  children,
}: {
  title: string;
  /** The button's words, when they differ from the dialog's title. */
  label?: string;
  ready: boolean;
  busy?: boolean;
  onSubmit: () => void;
  trigger?: 'primary' | 'secondary';
  children: ReactNode;
}) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={trigger} disabled={busy} onClick={() => setOpen(true)}>
        {label ?? title}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        closeLabel={m.common_close()}
        footer={
          <>
            <Button type="submit" form={formId} disabled={busy || !ready}>
              {label ?? m.form_save()}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {m.common_cancel()}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
            setOpen(false);
          }}
        >
          {children}
        </form>
      </Drawer>
    </>
  );
}
