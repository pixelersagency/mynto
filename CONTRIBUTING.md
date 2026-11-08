# Contribuer à mynto

Merci de vouloir aider. Ce guide tient en une page.

## Avant de commencer

- Un bug : ouvre une issue avec les étapes pour le reproduire, la version (commit) et les journaux utiles (`docker compose logs web scanner`), **sans secret ni donnée de prospect**.
- Une faille de sécurité : pas d'issue publique, voir [SECURITY.md](SECURITY.md).
- Une fonction nouvelle : ouvre d'abord une issue pour en discuter. Une PR qui arrive sans contexte risque d'attendre.

En participant, tu acceptes le [code de conduite](CODE_OF_CONDUCT.md).

## Installation pour développer

Prérequis : Node 22 (`.nvmrc`), pnpm 9, Postgres 16+ et Redis 7 (locaux ou via Docker).

```bash
pnpm install
pnpm --filter @mynto/scanner exec playwright install chromium
pnpm run setup -- --dev           # .env.local avec des secrets de dev
cp docker-compose.override.example.yml docker-compose.override.yml
docker compose up -d postgres redis
pnpm dev                          # web :3000, scanner :4000
```

Sans Docker pour Postgres, voir la section Développement du [README](README.md#développement) (rôle et base à créer).

## Avant d'ouvrir une PR

```bash
pnpm typecheck
pnpm lint
pnpm test                         # Postgres jetable : initdb local, Docker, ou TEST_DATABASE_URL
pnpm --filter @mynto/web build
```

Le hook pre-commit lance `gitleaks` (si installé) et `lint-staged`. La CI refait tout, plus le build des images Docker.

## Règles

- **TypeScript strict**, pas de `any`, Zod pour toute entrée externe (API, webhooks, formulaires, variables d'environnement).
- **Migrations** : `packages/db/migrations/NNNN_nom.sql`, une nouvelle migration à chaque changement. Ne modifie jamais une migration déjà publiée.
- **Sécurité** : jamais de secret dans le code ni dans les journaux (ni clé, ni jeton, ni email en clair). Toute URL fournie par un utilisateur passe par la garde SSRF (`apps/scanner/src/lib/url-guard.ts`).
- **Tests** : une correction de bug vient avec le test qui l'aurait attrapée. Les tests ne dépendent pas du réseau.
- **Accessibilité** du tableau de bord et des rapports : contraste AA, navigation au clavier, textes alternatifs.
- **Le score n'est pas une conformité** : aucun texte ne doit présenter un score comme « conforme RGAA » ou « conforme WCAG ».
- **Textes de l'interface** : français, tutoiement, phrases courtes, pas de tiret cadratin.
- **Commits** : [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scanner): …`, `fix(web): …`, `docs: …`).

## Licence des contributions

mynto est sous [AGPL-3.0-only](LICENSE). En proposant une contribution, tu acceptes qu'elle soit publiée sous cette licence et tu confirmes avoir le droit de la soumettre (code écrit par toi, ou compatible avec l'AGPL-3.0). Une nouvelle dépendance doit avoir une licence compatible : régénère [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) avec `pnpm licenses:notices`.
