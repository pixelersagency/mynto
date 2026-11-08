import type { Metadata } from 'next';

import { Topbar } from '../_components/Topbar';

import { SettingsNav } from './_components/SettingsNav';
import { SettingsSection } from './_components/SettingsSection';
import { FaviconForm } from './FaviconForm';
import { BrandForm, LogoForm } from './SettingsForms';

import { DEFAULT_PRIMARY_COLOR, getBranding } from '@/lib/branding';
import { db, pgErrorCode } from '@/lib/db';
import { getServerEnv, publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { scannerOnline } from '@/lib/scanner/client';

export const metadata: Metadata = { title: 'Réglages' };

export default async function SettingsPage(): Promise<React.ReactElement> {
  const brand = await getBranding();
  let dailyRate = '';
  try {
    const row = await db().settings.get();
    dailyRate = row?.daily_rate_eur?.toString() ?? '';
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'settings_read_failed');
  }
  const env = getServerEnv();
  const base = publicUrl();
  const online = await scannerOnline();

  return (
    <>
      <Topbar crumbs={[{ label: 'Réglages' }, { label: 'Marque' }]} />
      <SettingsNav active="marque" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="dash-display">Marque</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
            Ce que tes prospects voient sur les rapports, le PDF et l’aperçu de partage.
            {brand.source === 'env'
              ? ' Valeurs par défaut lues dans la configuration du serveur.'
              : ''}
          </p>
          <div className="mt-8">
            <SettingsSection
              id="brand-title"
              title="Identité"
              description="Nom, liens, couleur d’accent, taux journalier et pied de page des rapports."
            >
              <BrandForm
                defaultColor={DEFAULT_PRIMARY_COLOR}
                initial={{
                  name: brand.name,
                  website_url: brand.websiteUrl ?? '',
                  contact_url: brand.contactUrl ?? '',
                  primary_color: brand.primaryColor,
                  report_footer: brand.footer ?? '',
                  daily_rate_eur: dailyRate,
                }}
              />
            </SettingsSection>
            <SettingsSection
              id="logo-title"
              title="Logo"
              description="En tête des rapports et du PDF."
            >
              <LogoForm name={brand.name} logoUrl={brand.logoUrl} />
            </SettingsSection>
            <SettingsSection
              id="favicon-title"
              title="Favicon"
              description="Icône de l’onglet sur le tableau de bord, la connexion et les rapports publics."
            >
              <FaviconForm
                faviconUrl={brand.icons.faviconUrl}
                hasCustomFavicon={brand.hasCustomFavicon}
                hasLogo={brand.logoUrl !== null}
              />
            </SettingsSection>
            <SettingsSection
              id="integrations"
              title="Clés et intégrations"
              description="Les valeurs techniques se règlent dans les variables d’environnement."
            >
              <dl className="divide-y divide-[var(--border)] text-[13px]">
                <Row label="Adresse publique" value={<code className="font-mono">{base}</code>} />
                <Row label="Scanner" value={online ? 'Joignable' : 'Injoignable'} ok={online} />
                <Row
                  label="Jeton interne web vers scanner"
                  value={
                    env.SCANNER_INTERNAL_TOKEN ? 'Configuré' : 'Manquant (SCANNER_INTERNAL_TOKEN)'
                  }
                  ok={Boolean(env.SCANNER_INTERNAL_TOKEN)}
                />
                <Row
                  label="API publique et MCP"
                  value={
                    <a className="dash-link" href="/dashboard/reglages/api">
                      Clés et connexion dans « API et MCP »
                    </a>
                  }
                />
                <Row
                  label="API Radar"
                  value={
                    <span>
                      <code className="font-mono">{base}/api/radar/audits</code>, clé Bearer
                      RADAR_API_KEY côté scanner
                    </span>
                  }
                />
                <Row
                  label="Modèle d’analyse"
                  value={
                    <a className="dash-link" href="/dashboard/reglages/ia">
                      Fournisseur, modèle et clés dans « IA » (Claude par défaut)
                    </a>
                  }
                />
              </dl>
            </SettingsSection>
          </div>
        </div>
      </main>
    </>
  );
}

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 py-2.5 first:pt-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-52 shrink-0 text-[var(--fg-muted)]">{label}</dt>
      <dd
        className={
          ok === false
            ? 'flex items-center gap-1.5 font-medium text-[var(--danger)]'
            : 'flex items-center gap-1.5'
        }
      >
        {ok !== undefined ? (
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`}
          />
        ) : null}
        {value}
      </dd>
    </div>
  );
}
