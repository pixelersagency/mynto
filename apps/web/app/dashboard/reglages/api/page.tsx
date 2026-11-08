import type { ApiKeyRow } from '@mynto/db';
import { TOOL_NAMES } from '@mynto/mcp';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';
import { SettingsSection } from '../_components/SettingsSection';

import { ApiKeysPanel, CopyField, type ApiKeyView } from './ApiKeysPanel';

import { DashButton } from '@/components/ui/dash-button';
import { longDate } from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { getServerEnv, publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';

export const metadata: Metadata = { title: 'API et MCP' };

function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

export default async function ApiSettingsPage(): Promise<React.ReactElement> {
  let rows: ApiKeyRow[] = [];
  let failed = false;
  try {
    rows = await db().apiKeys.list();
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'api_keys_read_failed');
    failed = true;
  }
  const keys: ApiKeyView[] = rows.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdLabel: longDate(k.created_at),
    lastUsedLabel: k.last_used_at ? dateTime(k.last_used_at) : null,
    revoked: k.revoked_at !== null,
  }));
  const base = publicUrl();
  const limit = getServerEnv().API_RATE_LIMIT_PER_MINUTE;

  const claudeCode = `claude mcp add --transport http mynto ${base}/mcp --header "Authorization: Bearer <ta-clé>"`;
  const desktop = JSON.stringify(
    {
      mcpServers: {
        mynto: {
          command: 'node',
          args: ['/chemin/vers/mynto/packages/mcp/dist/mynto-mcp.mjs'],
          env: { MYNTO_URL: base, MYNTO_API_KEY: '<ta-clé>' },
        },
      },
    },
    null,
    2,
  );
  const curl = `curl -H "Authorization: Bearer <ta-clé>" ${base}/api/v1/audits`;

  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'API et MCP' },
        ]}
      />
      <SettingsNav active="api" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl space-y-8">
          <section aria-labelledby="api-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 id="api-title" className="dash-display">
                  API et MCP
                </h1>
                <p className="mt-1 max-w-xl text-[13px] text-[var(--fg-muted)]">
                  Lance et lis tes audits depuis tes propres outils, ou depuis Claude. Une clé donne
                  accès à toute l’instance : garde-la secrète. Limite : {limit} requêtes par minute
                  et par clé.
                </p>
              </div>
              <DashButton asChild size="md">
                <Link href="/dashboard/reglages/api/reference">Référence de l’API</Link>
              </DashButton>
            </div>
            {failed ? (
              <p role="alert" className="dash-note dash-note--danger mt-4">
                Impossible de lire les clés. Vérifie la base de données.
              </p>
            ) : null}
          </section>
          <div>
            <SettingsSection
              id="keys-title"
              title="Clés API"
              description="Une clé par outil. Tu peux la révoquer à tout moment."
            >
              <ApiKeysPanel keys={keys} />
            </SettingsSection>
            <SettingsSection
              id="connect-title"
              title="Connecter Claude"
              description={
                <>
                  Le serveur MCP propose {TOOL_NAMES.length} outils : audits, constats, liens,
                  statistiques, modèles et webhooks. Remplace{' '}
                  <code className="font-mono">&lt;ta-clé&gt;</code> par une clé créée ci-dessus.
                </>
              }
            >
              <div className="space-y-5">
                <CopyField id="snippet-code" label="Claude Code (HTTP)" value={claudeCode} />
                <CopyField
                  id="snippet-desktop"
                  label="Claude Desktop (stdio), dans claude_desktop_config.json"
                  value={desktop}
                />
                <p className="text-[12px] text-[var(--fg-muted)]">
                  Pour Claude Desktop, construis d’abord le binaire :{' '}
                  <code className="font-mono">pnpm --filter @mynto/mcp build</code>. Il parle à
                  l’API REST de cette instance.
                </p>
                <CopyField id="snippet-curl" label="API REST (curl)" value={curl} />
              </div>
            </SettingsSection>
          </div>
        </div>
      </main>
    </>
  );
}
