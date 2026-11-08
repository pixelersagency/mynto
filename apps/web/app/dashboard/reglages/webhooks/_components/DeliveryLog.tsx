'use client';

import type { ApiWebhookDelivery } from '@mynto/shared';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronRight, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Feedback } from '../../_components/Feedback';
import { deliveryDetailAction, resendDeliveryAction, type WebhookFormState } from '../actions';

import { DeliveryStatus, dateTime, errorLabel, eventLabel, Pill } from './ui';

import { DashButton } from '@/components/ui/dash-button';

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}

/** Delivery log of one webhook (30 days) with a detail drawer and "Renvoyer". */
export function DeliveryLog({
  webhookId,
  rows,
}: {
  webhookId: string;
  rows: ApiWebhookDelivery[];
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApiWebhookDelivery | null>(null);
  const [loading, startLoad] = useTransition();
  const [resending, startResend] = useTransition();
  const [result, setResult] = useState<WebhookFormState>({ ok: false, message: null });

  function show(id: string): void {
    setOpen(id);
    setDetail(null);
    setResult({ ok: false, message: null });
    startLoad(async () => {
      setDetail(await deliveryDetailAction(webhookId, id));
    });
  }

  if (rows.length === 0) {
    return (
      <p className="border-t border-[var(--border)] pt-4 text-[13px] text-[var(--fg-muted)]">
        Aucune livraison sur les 30 derniers jours. Envoie un ping pour tester.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto border-t border-[var(--border)]">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">
            Livraisons : date, événement, statut, code HTTP, durée, tentatives.
          </caption>
          <thead>
            <tr className="text-left text-[var(--fg-muted)]">
              {['Date', 'Événement', 'Statut', 'Code', 'Durée', 'Tentative'].map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`h-9 border-b border-[var(--border)] px-3 font-normal ${i >= 3 ? 'max-sm:hidden' : ''}`}
                >
                  {h}
                </th>
              ))}
              <th scope="col" className="h-9 border-b border-[var(--border)] px-3 font-normal">
                <span className="sr-only">Détail</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                className="h-11 border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-subtle)]"
              >
                <td className="whitespace-nowrap px-3 tabular-nums">{dateTime(d.created_at)}</td>
                <td className="px-3">
                  <span className="font-medium">{eventLabel(d.event_type)}</span>
                  {d.manual ? (
                    <span className="ml-1.5 text-[12px] text-[var(--fg-muted)]">(renvoi)</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3">
                  <DeliveryStatus status={d.status} attempts={d.attempts} />
                </td>
                <td className="px-3 tabular-nums max-sm:hidden">{d.last_status_code ?? '-'}</td>
                <td className="whitespace-nowrap px-3 tabular-nums max-sm:hidden">
                  {d.last_duration_ms !== null ? `${String(d.last_duration_ms)} ms` : '-'}
                </td>
                <td className="px-3 tabular-nums max-sm:hidden">{d.attempts}/6</td>
                <td className="px-3 text-right">
                  <DashButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Détail de la livraison du ${dateTime(d.created_at)}`}
                    onClick={() => {
                      show(d.id);
                    }}
                  >
                    Détail <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </DashButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DialogPrimitive.Root
        open={open !== null}
        onOpenChange={(v) => {
          if (!v) setOpen(null);
        }}
      >
        <DialogPrimitive.Portal>
          <div className="dash" style={{ display: 'contents' }}>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-[var(--shadow-pop)]"
            >
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3">
                <DialogPrimitive.Title className="text-[16px] font-semibold">
                  {detail ? eventLabel(detail.event_type) : 'Livraison'}
                </DialogPrimitive.Title>
                {detail ? (
                  <DeliveryStatus status={detail.status} attempts={detail.attempts} />
                ) : null}
                <DialogPrimitive.Close
                  className="ml-auto rounded-md p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-hover)]"
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {loading || detail === null ? (
                  <p className="text-[13px] text-[var(--fg-muted)]">
                    {loading ? 'Chargement…' : 'Livraison introuvable.'}
                  </p>
                ) : (
                  <>
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                      <dt className="text-[var(--fg-muted)]">Événement</dt>
                      <dd>
                        <code className="font-mono text-[12px]">{detail.event_type}</code>
                      </dd>
                      <dt className="text-[var(--fg-muted)]">Id d’événement</dt>
                      <dd>
                        <code className="break-all font-mono text-[12px]">{detail.event_id}</code>
                      </dd>
                      <dt className="text-[var(--fg-muted)]">Livraison</dt>
                      <dd>
                        <code className="break-all font-mono text-[12px]">{detail.id}</code>
                      </dd>
                      <dt className="text-[var(--fg-muted)]">Créée</dt>
                      <dd>{dateTime(detail.created_at)}</dd>
                      {detail.next_attempt_at ? (
                        <>
                          <dt className="text-[var(--fg-muted)]">Prochain essai</dt>
                          <dd>{dateTime(detail.next_attempt_at)}</dd>
                        </>
                      ) : null}
                      <dt className="text-[var(--fg-muted)]">Format</dt>
                      <dd>{detail.format === 'legacy_radar' ? 'Radar historique' : 'Standard'}</dd>
                    </dl>

                    <section aria-labelledby="attempts-title">
                      <h3 id="attempts-title" className="mb-2 text-[13px] font-medium">
                        Tentatives
                      </h3>
                      {(detail.attempts_log ?? []).length === 0 ? (
                        <p className="text-[13px] text-[var(--fg-muted)]">Pas encore envoyée.</p>
                      ) : (
                        <ol className="space-y-2">
                          {(detail.attempts_log ?? []).map((a) => (
                            <li
                              key={a.attempt}
                              className="rounded-lg border border-[var(--border)] p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                <span className="font-medium">Tentative {a.attempt}</span>
                                {a.status_code !== null &&
                                a.status_code >= 200 &&
                                a.status_code < 300 ? (
                                  <Pill tone="success">HTTP {a.status_code}</Pill>
                                ) : (
                                  <Pill tone="danger">
                                    {a.status_code !== null
                                      ? `HTTP ${String(a.status_code)}`
                                      : 'Sans réponse'}
                                  </Pill>
                                )}
                                <span className="tabular-nums text-[var(--fg-muted)]">
                                  {a.duration_ms} ms, {dateTime(a.created_at)}
                                </span>
                              </div>
                              {a.error && !a.error.startsWith('http_') ? (
                                <p className="mt-1 text-[12px] text-[var(--danger)]">
                                  {errorLabel(a.error)}
                                </p>
                              ) : null}
                              {a.response_body ? (
                                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-subtle)] p-2 font-mono text-[12px] leading-5">
                                  {a.response_body}
                                </pre>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      )}
                      <p className="mt-2 text-[12px] text-[var(--fg-muted)]">
                        Réponse tronquée à 2 Ko.
                      </p>
                    </section>

                    <section aria-labelledby="body-title">
                      <h3 id="body-title" className="mb-2 text-[13px] font-medium">
                        Corps envoyé
                      </h3>
                      <pre
                        tabIndex={0}
                        className="max-h-80 overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-3 font-mono text-[12px] leading-5"
                      >
                        {prettyJson(detail.request_body ?? '')}
                      </pre>
                    </section>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 border-t border-[var(--border)] px-5 py-3">
                <DashButton
                  variant="primary"
                  disabled={detail === null || resending}
                  onClick={() => {
                    if (open === null) return;
                    startResend(async () => {
                      setResult(await resendDeliveryAction(webhookId, open));
                      router.refresh();
                      window.setTimeout(() => {
                        router.refresh();
                      }, 5000);
                    });
                  }}
                >
                  Renvoyer
                </DashButton>
                <p className="text-[12px] text-[var(--fg-muted)]">Même événement, même id.</p>
                <div className="ml-auto">
                  <Feedback state={result} />
                </div>
              </div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
