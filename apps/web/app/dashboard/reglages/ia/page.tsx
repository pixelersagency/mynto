import {
  DEFAULT_AI_MODELS,
  hasValidMasterKey,
  type AiKeyInfo,
  type AiSettingsRow,
} from '@mynto/db';
import type { Metadata } from 'next';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';
import { SettingsSection } from '../_components/SettingsSection';

import { ProviderKeyCard, ProviderSettingsForm, type KeyInfo, type Provider } from './AiForms';

import { longDate } from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export const metadata: Metadata = { title: 'IA' };

export default async function AiSettingsPage(): Promise<React.ReactElement> {
  const env = getServerEnv();
  let settings: AiSettingsRow | null = null;
  let keys: AiKeyInfo[] = [];
  let failed = false;
  try {
    [settings, keys] = await Promise.all([db().ai.getSettings(), db().ai.listKeys()]);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'ai_settings_read_failed');
    failed = true;
  }
  const canSave = hasValidMasterKey(env.APP_ENCRYPTION_KEY);
  const narrative: Provider = settings?.narrative_provider ?? env.AUDIT_LLM_PROVIDER ?? 'anthropic';
  const vision = settings?.vision_provider ?? env.VISION_LLM_PROVIDER ?? 'anthropic';
  const m = settings?.models ?? {};
  const models: Record<string, string> = {
    model_anthropic_narrative: m.anthropic?.narrative ?? '',
    model_anthropic_vision: m.anthropic?.vision ?? '',
    model_gemini_narrative: m.gemini?.narrative ?? '',
    model_gemini_vision: m.gemini?.vision ?? '',
    model_mistral_narrative: m.mistral?.narrative ?? '',
  };
  const defaults: Record<string, string> = {
    model_anthropic_narrative: DEFAULT_AI_MODELS.anthropic.narrative,
    model_anthropic_vision: DEFAULT_AI_MODELS.anthropic.vision,
    model_gemini_narrative: DEFAULT_AI_MODELS.gemini.narrative,
    model_gemini_vision: DEFAULT_AI_MODELS.gemini.vision,
    model_mistral_narrative: DEFAULT_AI_MODELS.mistral.narrative,
  };
  const envKey: Record<Provider, boolean> = {
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    mistral: Boolean(env.MISTRAL_API_KEY),
  };
  const cards: KeyInfo[] = (['anthropic', 'gemini', 'mistral'] as const).map((p) => {
    const stored = keys.find((k) => k.provider === p);
    const roles = [
      narrative === p ? 'rédaction' : null,
      vision === p ? 'analyse visuelle' : null,
    ].filter(Boolean);
    return {
      provider: p,
      hint: stored?.key_hint ?? null,
      updatedLabel: stored ? longDate(stored.updated_at) : null,
      envFallback: envKey[p],
      purpose: narrative === p || p === 'mistral' ? 'narrative' : 'vision',
      inUse: roles.length > 0 ? `Utilisé pour : ${roles.join(' et ')}.` : null,
    };
  });

  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'IA' },
        ]}
      />
      <SettingsNav active="ia" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="dash-display">IA</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            Le fournisseur et le modèle qui rédigent les rapports et lisent les captures. Le scanner
            lit ces réglages au début de chaque audit (30 secondes de délai au plus).
          </p>
          {failed ? (
            <p role="alert" className="dash-note dash-note--danger mt-4">
              Impossible de lire les réglages IA. Vérifie la base de données.
            </p>
          ) : null}
          <div className="mt-8">
            <SettingsSection
              id="ai-title"
              title="Fournisseurs et modèles"
              description="Qui rédige le rapport, qui lit la capture d’écran."
            >
              <ProviderSettingsForm
                initial={{
                  narrative_provider: narrative,
                  vision_provider: vision,
                  models,
                  defaults,
                }}
              />
            </SettingsSection>
            <SettingsSection
              id="keys-title"
              title="Clés API"
              description={
                <>
                  Chiffrées en base (AES-256-GCM), jamais renvoyées au navigateur. Sans clé, le
                  scanner lit ANTHROPIC_API_KEY, GEMINI_API_KEY ou MISTRAL_API_KEY.
                </>
              }
            >
              {!canSave ? (
                <p role="alert" className="dash-note dash-note--warning mb-5">
                  Enregistrement des clés désactivé : APP_ENCRYPTION_KEY manque ou n’a pas 32
                  octets. Génère-la avec <code className="font-mono">openssl rand -base64 32</code>,
                  ajoute la même valeur au web et au scanner, puis redémarre.
                </p>
              ) : null}
              <div className="divide-y divide-[var(--border)]">
                {cards.map((c) => (
                  <ProviderKeyCard key={c.provider} info={c} canSave={canSave} />
                ))}
              </div>
              <p className="mt-4 text-[12px] text-[var(--fg-muted)]">
                Anthropic (Claude) est le fournisseur par défaut. « Tester la connexion » fait un
                appel minimal, sans génération de texte.
              </p>
            </SettingsSection>
          </div>
        </div>
      </main>
    </>
  );
}
