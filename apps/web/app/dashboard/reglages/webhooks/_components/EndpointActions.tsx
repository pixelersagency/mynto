'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Feedback } from '../../_components/Feedback';
import { CopyField } from '../../api/ApiKeysPanel';
import {
  deleteWebhookAction,
  pingWebhookAction,
  rotateSecretAction,
  type WebhookFormState,
} from '../actions';

import { DashButton } from '@/components/ui/dash-button';

/** Ping, secret regeneration and deletion of one webhook. */
export function EndpointActions({
  id,
  managedByEnv,
}: {
  id: string;
  managedByEnv: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [state, setState] = useState<WebhookFormState>({ ok: false, message: null });
  const [confirm, setConfirm] = useState<'rotate' | 'delete' | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DashButton
          disabled={busy}
          onClick={() => {
            start(async () => {
              setState(await pingWebhookAction(id));
              router.refresh();
              // The dispatcher sends it within seconds: refresh the log once more.
              window.setTimeout(() => {
                router.refresh();
              }, 5000);
            });
          }}
        >
          Envoyer un ping
        </DashButton>
        {!managedByEnv ? (
          confirm === 'rotate' ? (
            <span className="inline-flex items-center gap-1.5">
              <DashButton
                variant="danger"
                disabled={busy}
                onClick={() => {
                  start(async () => {
                    setState(await rotateSecretAction(id));
                    setConfirm(null);
                  });
                }}
              >
                Confirmer : l’ancien secret cesse de marcher
              </DashButton>
              <DashButton
                variant="ghost"
                onClick={() => {
                  setConfirm(null);
                }}
              >
                Annuler
              </DashButton>
            </span>
          ) : (
            <DashButton
              onClick={() => {
                setConfirm('rotate');
              }}
            >
              Régénérer le secret
            </DashButton>
          )
        ) : null}
        {!managedByEnv ? (
          confirm === 'delete' ? (
            <span className="inline-flex items-center gap-1.5">
              <DashButton
                variant="danger"
                disabled={busy}
                onClick={() => {
                  start(async () => {
                    const res = await deleteWebhookAction(id);
                    if (res.ok) router.push('/dashboard/reglages/webhooks');
                    else setState(res);
                    setConfirm(null);
                  });
                }}
              >
                Confirmer la suppression
              </DashButton>
              <DashButton
                variant="ghost"
                onClick={() => {
                  setConfirm(null);
                }}
              >
                Annuler
              </DashButton>
            </span>
          ) : (
            <DashButton
              className="text-[var(--danger)]"
              onClick={() => {
                setConfirm('delete');
              }}
            >
              Supprimer
            </DashButton>
          )
        ) : null}
      </div>
      {state.ok && state.secret ? (
        <div role="status" className="dash-note space-y-3">
          <p className="text-[13px] font-medium text-[var(--success)]">{state.message}</p>
          <CopyField id="rotated-secret" label="Nouveau secret de signature" value={state.secret} />
        </div>
      ) : (
        <Feedback state={state} />
      )}
    </div>
  );
}
