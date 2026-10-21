import { Button, CopyButton } from '@kete/design';
import { useState } from 'react';
import { makeFeed } from '@/lib/time';
import * as m from '@/paraglide/messages.js';

// Planifier in Outlook (spec 098, FR-018): her days under a secret address her calendar subscribes
// to. The address is shown once; « Renouveler » makes a new one and closes the old.
export function OutlookFeed({ since }: { since: string | null }) {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section
      aria-label={m.plan_outlook()}
      className="mt-6 grid gap-2 rounded-box border border-line bg-surface p-4 text-body-sm"
    >
      <h2 className="font-semibold">{m.plan_outlook()}</h2>
      <p className="text-fg-muted">{m.plan_outlook_explain()}</p>
      {address ? (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-control border border-line bg-bg px-2 py-1 break-all">
              {address}
            </code>
            <CopyButton
              text={address}
              label={m.plan_outlook_copy()}
              copiedLabel={m.plan_outlook_copied()}
            />
          </p>
          <p className="text-fg-muted">{m.plan_outlook_how()}</p>
        </>
      ) : (
        <span>
          <Button
            variant={since ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void makeFeed()
                .then(setAddress)
                .finally(() => setBusy(false));
            }}
          >
            {since ? m.plan_outlook_renew() : m.plan_outlook_make()}
          </Button>
        </span>
      )}
    </section>
  );
}
