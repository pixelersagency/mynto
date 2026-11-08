import type { ApiWebhook, ApiWebhookDelivery } from '@mynto/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Topbar } from '../../../_components/Topbar';
import { SettingsNav } from '../../_components/SettingsNav';
import { DeliveryLog } from '../_components/DeliveryLog';
import { EndpointActions } from '../_components/EndpointActions';
import { EndpointStatus, Pill, dateTime } from '../_components/ui';
import { WebhookForm } from '../_components/WebhookForm';

import { ServiceError } from '@/lib/services/audits';
import { allowPrivateTargets, getWebhook, listDeliveries } from '@/lib/services/webhooks';

export const metadata: Metadata = { title: 'Webhook' };
export const dynamic = 'force-dynamic';

export default async function WebhookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) notFound();
  let w: ApiWebhook;
  let deliveries: ApiWebhookDelivery[] = [];
  let total = 0;
  try {
    w = await getWebhook(id.data);
    const res = await listDeliveries(id.data, { limit: 50, offset: 0 });
    deliveries = res.data;
    total = res.pagination.total;
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'not_found') notFound();
    throw err;
  }

  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Webhooks', href: '/dashboard/reglages/webhooks' },
          { label: w.description ?? 'Webhook' },
        ]}
      />
      <SettingsNav active="webhooks" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl space-y-8">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-all font-mono text-[16px] font-semibold">{w.url}</h1>
              <EndpointStatus
                active={w.active}
                disabledReason={w.disabled_reason}
                lastStatus={w.last_status}
                lastCode={w.last_status_code}
              />
              {w.managed_by_env ? <Pill tone="accent">Géré par le .env</Pill> : null}
            </div>
            <p className="text-[12px] text-[var(--fg-muted)]">
              Créé le {dateTime(w.created_at)}
              {w.secret_hint ? (
                <>
                  {' '}
                  · secret <code className="font-mono">{w.secret_hint}</code>
                </>
              ) : (
                <> · signé avec RADAR_WEBHOOK_SECRET</>
              )}
              {w.consecutive_failures > 0
                ? ` · ${String(w.consecutive_failures)} échecs de suite`
                : ''}
            </p>
            {!w.active && w.disabled_reason === 'auto' ? (
              <p role="alert" className="dash-note dash-note--danger flex items-start gap-2">
                Désactivé le {dateTime(w.disabled_at)} après 20 échecs de suite. Corrige la cible,
                envoie un ping, puis active « Actif ».
              </p>
            ) : null}
            <EndpointActions id={w.id} managedByEnv={w.managed_by_env} />
          </header>

          <section aria-labelledby="log-title" className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="log-title" className="dash-heading">
                Journal des livraisons
              </h2>
              <span className="text-[12px] text-[var(--fg-muted)]">
                {total > deliveries.length
                  ? `${String(deliveries.length)} plus récentes sur ${String(total)}, 30 jours`
                  : '30 derniers jours'}
              </span>
            </div>
            <DeliveryLog webhookId={w.id} rows={deliveries} />
          </section>

          <section aria-labelledby="edit-title" className="space-y-3">
            <h2 id="edit-title" className="dash-heading">
              Réglages du webhook
            </h2>
            <div className="dash-group">
              <WebhookForm
                mode="edit"
                allowPrivate={allowPrivateTargets()}
                initial={{
                  id: w.id,
                  url: w.url,
                  description: w.description ?? '',
                  events: w.events,
                  active: w.active,
                  legacyRadarFormat: w.legacy_radar_format,
                  managedByEnv: w.managed_by_env,
                }}
              />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
