import type { Metadata } from 'next';

import { Topbar } from '../../../_components/Topbar';
import { SettingsNav } from '../../_components/SettingsNav';
import { WebhookForm } from '../_components/WebhookForm';

import { allowPrivateTargets } from '@/lib/services/webhooks';

export const metadata: Metadata = { title: 'Nouveau webhook' };
export const dynamic = 'force-dynamic';

export default function NewWebhookPage(): React.ReactElement {
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Webhooks', href: '/dashboard/reglages/webhooks' },
          { label: 'Nouveau' },
        ]}
      />
      <SettingsNav active="webhooks" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="dash-display">Nouveau webhook</h1>
          <p className="mt-1 mb-6 max-w-xl text-[13px] text-[var(--fg-muted)]">
            Indique l’adresse de ton outil et les événements à recevoir. Le secret de signature
            s’affiche une seule fois, juste après la création.
          </p>
          <div className="dash-group">
            <WebhookForm
              mode="create"
              allowPrivate={allowPrivateTargets()}
              initial={{
                url: '',
                description: '',
                events: ['audit.completed', 'link.first_opened'],
                active: true,
                legacyRadarFormat: false,
                managedByEnv: false,
              }}
            />
          </div>
        </div>
      </main>
    </>
  );
}
