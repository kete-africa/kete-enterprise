import { createFileRoute, redirect } from '@tanstack/react-router';
import { requirePerson } from '@/lib/signed-in';
import { fetchThreadOf } from '@/lib/threads';

/** An object's thread, as « Pour moi » links it: opened in the threads screen. */
export const Route = createFileRoute('/fils/$kind/$id')({
  beforeLoad: async ({ location, params }) => {
    await requirePerson(location.href);
    const thread = await fetchThreadOf({ data: { kind: params.kind, id: params.id } });
    throw redirect({ to: '/fils', search: thread ? { fil: thread.id } : {} });
  },
});
