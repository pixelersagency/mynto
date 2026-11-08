import {
  AI_SITE_TYPE_DESCRIPTION,
  AI_SITE_TYPE_INPUTS,
  AI_SITE_TYPE_LABEL,
  ALL_AXES,
  type AuditModules,
} from '@mynto/shared';

import { RadioGroup } from '@/components/ui/radio-group';
import { SwitchField } from '@/components/ui/switch';
import { AXIS_LONG } from '@/lib/dashboard/format';

/**
 * Module switches, shared by Réglages > Modules d'audit (defaults) and
 * Nouvel audit (override). Posts `axes` (multiple) + one field per collector.
 */

const AXIS_HINT: Record<(typeof ALL_AXES)[number], string> = {
  seo_technique: 'Meta, sitemap, robots, données structurées',
  seo_contenu: 'Contenus, blog, lisibilité',
  performance: 'Poids, Core Web Vitals',
  accessibilite: 'RGAA, WCAG, contrastes',
  conformite: 'Mentions légales, RGPD, cookies',
  conversion: 'Appels à l’action, contact, preuves',
  ux: 'Parcours, mobile, navigation',
  ui: 'Hiérarchie visuelle, cohérence',
};

const COLLECTORS: {
  name: 'lighthouse' | 'vision' | 'hero' | 'narrative';
  label: string;
  hint: string;
}[] = [
  {
    name: 'lighthouse',
    label: 'Lighthouse',
    hint: 'Mesure de performance et d’accessibilité. Ajoute 30 à 60 secondes par audit.',
  },
  {
    name: 'vision',
    label: 'Analyse visuelle par IA',
    hint: 'Une capture analysée par le modèle de vision (UI, UX, conversion). Facturée à l’appel.',
  },
  {
    name: 'hero',
    label: 'Capture d’en-tête',
    hint: 'Image du haut de la page d’accueil, en tête du rapport.',
  },
  {
    name: 'narrative',
    label: 'Rédaction par IA',
    hint: 'Synthèse, priorités et recommandations rédigées. Sans elle, le rapport garde un texte standard.',
  },
];

export function ModulesFieldset({
  initial,
  error,
  idPrefix = 'mod',
  withAi = true,
  showGlobalScoreSetting = false,
}: {
  initial: AuditModules;
  error?: string | undefined;
  idPrefix?: string;
  /** Include the Préparation IA fieldset (Nouvel audit renders it on its own). */
  withAi?: boolean;
  /** Réglages only: the "include in the global score" install setting. */
  showGlobalScoreSetting?: boolean;
}): React.ReactElement {
  return (
    <div className="space-y-6">
      <fieldset aria-describedby={error ? `${idPrefix}-axes-error` : undefined}>
        <legend className="text-[13px] font-medium">Axes évalués</legend>
        <p className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
          Un axe désactivé n’est pas analysé. Le rapport l’affiche « Non évalué » et le score global
          ne compte que les axes activés.
        </p>
        <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {ALL_AXES.map((axis) => (
            <li key={axis}>
              <SwitchField
                id={`${idPrefix}-axis-${axis}`}
                name="axes"
                value={axis}
                defaultChecked={initial.axes.includes(axis)}
                label={AXIS_LONG[axis]}
                description={AXIS_HINT[axis]}
              />
            </li>
          ))}
        </ul>
        {error ? (
          <p
            id={`${idPrefix}-axes-error`}
            role="alert"
            className="mt-2 text-[12px] text-[var(--danger)]"
          >
            {error}
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-medium">Collecteurs coûteux</legend>
        <p className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
          Plus lents ou facturés par ton fournisseur d’IA. Un collecteur ne tourne que si un axe qui
          l’utilise est activé.
        </p>
        <ul className="mt-3 space-y-2.5">
          {COLLECTORS.map((c) => (
            <li key={c.name}>
              <SwitchField
                id={`${idPrefix}-${c.name}`}
                name={c.name}
                defaultChecked={initial[c.name]}
                label={c.label}
                description={c.hint}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      {withAi ? (
        <AiReadinessFieldset
          initial={initial}
          idPrefix={idPrefix}
          showGlobalScoreSetting={showGlobalScoreSetting}
        />
      ) : null}
    </div>
  );
}

/**
 * Préparation IA (optional 9th module): on/off, site type, and in Réglages
 * the install setting that folds its score into the global score.
 */
export function AiReadinessFieldset({
  initial,
  idPrefix = 'mod',
  showGlobalScoreSetting = false,
}: {
  initial: AuditModules;
  idPrefix?: string;
  showGlobalScoreSetting?: boolean;
}): React.ReactElement {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium">Préparation IA</legend>
      <p className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
        24 tests sur ce qu’un agent IA trouve, lit et peut utiliser sur le site : llms.txt, règles
        pour les robots d’IA, protocoles MCP et agents. Environ 20 secondes, sans appel à un modèle.
        Score à part, sur 100.
      </p>
      <ul className="mt-3 space-y-3">
        <li>
          <SwitchField
            id={`${idPrefix}-ai_readiness`}
            name="ai_readiness"
            defaultChecked={initial.ai_readiness}
            label="Tester la préparation IA"
            description="Désactivé, le rapport affiche « Non évalué »."
          />
        </li>
        <li className="pl-12">
          <RadioGroup
            name="site_type"
            idPrefix={`${idPrefix}-site_type`}
            legend="Type de site"
            hint="Décide quels tests comptent. Un site vitrine n’est testé ni sur les API ni sur le paiement."
            columns={2}
            defaultValue={initial.site_type}
            options={AI_SITE_TYPE_INPUTS.map((t) => ({
              value: t,
              label: AI_SITE_TYPE_LABEL[t],
              description: AI_SITE_TYPE_DESCRIPTION[t],
            }))}
          />
        </li>
        {showGlobalScoreSetting ? (
          <li>
            <SwitchField
              id={`${idPrefix}-ai_in_global_score`}
              name="ai_in_global_score"
              defaultChecked={initial.ai_in_global_score}
              label="Inclure la préparation IA dans le score global"
              description="Désactivé par défaut, pour garder des scores comparables d’un audit à l’autre. Activé, la note IA compte comme un axe de poids 1 dans les nouveaux audits."
            />
          </li>
        ) : null}
      </ul>
    </fieldset>
  );
}
