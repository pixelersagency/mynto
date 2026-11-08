import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';

import { Topbar } from '../../../_components/Topbar';
import { SettingsNav } from '../../_components/SettingsNav';

import { listOperations, openApiDocument } from '@/lib/api/openapi';
import { publicUrl } from '@/lib/env';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Référence de l’API' };

const METHOD_TONE: Record<string, string> = {
  GET: 'text-[var(--fg-muted)]',
  POST: 'text-[var(--fg)]',
  DELETE: 'text-[var(--danger)]',
};

const EXAMPLE_AUDIT = `{
  "id": "3f2b8c1e-9a4d-4c2b-8f1e-0123456789ab",
  "url": "https://example.com/",
  "label": "Client Martin",
  "status": "completed",
  "source": "api",
  "score": 72,
  "band": "good",
  "axes": [
    { "axis": "seo_technique", "evaluated": true, "score": 80, "band": "good" },
    { "axis": "ui", "evaluated": false, "score": null, "band": null }
  ],
  "modules": { "axes": ["seo_technique", "..."], "lighthouse": true,
               "vision": false, "hero": true, "narrative": true },
  "report_url": "https://audit.agence.fr/audit/full/k3j...",
  "tracking_url": "https://audit.agence.fr/r/Qm9...",
  "views_count": 0,
  "...": "..."
}`;

/** Static reference rendered from the same OpenAPI object as /api/v1/openapi.json. */
export default function ApiReferencePage(): React.ReactElement {
  const base = publicUrl();
  const ops = listOperations(openApiDocument(base));
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'API et MCP', href: '/dashboard/reglages/api' },
          { label: 'Référence' },
        ]}
      />
      <SettingsNav active="api" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl space-y-8">
          <header>
            <h1 className="flex items-center gap-2 dash-display">
              <BookOpen className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden="true" />
              Référence de l’API v1
            </h1>
            <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
              Base : <code className="font-mono">{base}/api/v1</code>. Authentification :{' '}
              <code className="font-mono">Authorization: Bearer myn_live_…</code>. Les erreurs sont
              en JSON <code className="font-mono">{'{ "error", "message" }'}</code>. Description
              complète au format OpenAPI 3.1 :{' '}
              <a className="dash-link" href="/api/v1/openapi.json">
                /api/v1/openapi.json
              </a>
              .
            </p>
          </header>
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {ops.map((op) => (
              <li key={`${op.method} ${op.path}`} className="py-3.5">
                <h2 className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span
                    className={cn(
                      'inline-flex min-w-14 font-mono text-[12px] font-medium',
                      METHOD_TONE[op.method],
                    )}
                  >
                    {op.method}
                  </span>
                  <code className="font-mono font-medium">{op.path}</code>
                  <span className="text-[var(--fg-muted)]">{op.summary}</span>
                </h2>
                {op.description ? (
                  <p className="mt-1.5 text-[12px] leading-5 text-[var(--fg-muted)]">
                    {op.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <section aria-labelledby="ex-title" className="space-y-2">
            <h2 id="ex-title" className="dash-heading">
              Exemple d’audit renvoyé
            </h2>
            <p className="text-[12px] text-[var(--fg-muted)]">
              Un axe désactivé a <code className="font-mono">evaluated: false</code> et aucun score.
              Le score global ne porte que sur les axes évalués. L’e-mail de contact et les données
              envoyées à l’IA ne sont jamais renvoyés.
            </p>
            <pre
              tabIndex={0}
              className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] p-3 font-mono text-[12px] leading-5"
            >
              {EXAMPLE_AUDIT}
            </pre>
          </section>
          <section aria-labelledby="codes-title" className="space-y-2">
            <h2 id="codes-title" className="dash-heading">
              Codes d’erreur
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
              {[
                ['401 unauthorized', 'Clé absente, invalide ou révoquée.'],
                ['429 rate_limited', 'Trop de requêtes pour cette clé (voir Retry-After).'],
                ['400 invalid_request', 'Paramètre ou corps invalide.'],
                ['400 unsafe_url', 'Adresse privée ou injoignable.'],
                ['404 not_found', 'Audit introuvable.'],
                ['503 scanner_unreachable', 'Le scanner ou la file ne répond pas.'],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>
                    <code className="font-mono">{k}</code>
                  </dt>
                  <dd className="text-[var(--fg-muted)]">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>
    </>
  );
}
