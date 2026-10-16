import { createFileRoute, redirect } from '@tanstack/react-router';

/** A card « à classer » is settled in « Pour moi », where it waits (spec 090). */
export const Route = createFileRoute('/fils/a-classer/$ref')({
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
