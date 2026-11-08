'use client';

import { useOptimistic, useTransition } from 'react';

import { setWebhookActiveAction } from '../actions';

import { Switch } from '@/components/ui/switch';

/** Active switch of a webhook in the list (optimistic). */
export function ActiveToggle({
  id,
  active,
  label,
}: {
  id: string;
  active: boolean;
  label: string;
}): React.ReactElement {
  const [on, setOn] = useOptimistic(active);
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={on}
      aria-label={`Webhook actif : ${label}`}
      disabled={pending}
      onCheckedChange={(next) => {
        start(async () => {
          setOn(next);
          await setWebhookActiveAction(id, next);
        });
      }}
    />
  );
}
