# Changelog

Toutes les évolutions notables de mynto sont notées ici. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.1.0] - 2026-11-08

Première version publique.

### Ajouté

- Audit de site sur 8 axes : SEO technique, SEO contenu, performance (Lighthouse), accessibilité (axe-core), conformité légale, conversion, UX, UI. Score global et par axe sur 100, problèmes classés par priorité, chiffrage indicatif du temps de correction.
- Module optionnel Préparation IA : 24 tests déterministes (robots IA, llms.txt, Markdown, protocoles MCP et agents, commerce agentique), score à part, types de site.
- Rédaction par IA optionnelle (Claude par défaut, Gemini, Mistral), avec repli déterministe sans clé.
- Tableau de bord d'agence au style Minimaliste (clair et sombre) : accueil, liste et fiche des audits, historique des scores, Analytics, palette de commandes, réglages (marque, favicon, IA, SMTP, modèles, polices, modules, webhooks, clés API).
- Liens de suivi `/r/<jeton>` sans cookie ; l'IP n'est jamais conservée en clair (empreinte HMAC purgée automatiquement).
- Trois modèles de rapport en Liquid : Minimaliste (par défaut), Bento et Style Mynto, plus les tiens. Rapport web et PDF identiques, polices servies localement.
- Favicon de l'agence (PNG, SVG ou ICO), par défaut son logo, sur le tableau de bord et les rapports.
- Envoi des rapports par email via ton serveur SMTP.
- API REST v1 (OpenAPI), serveur MCP (HTTP et stdio).
- Webhooks sortants signés (HMAC), 10 événements, nouvelles tentatives, journal des livraisons.
- Intégration Radar optionnelle (API générique de demande d'audits).
- Installation par `docker compose` (web, scanner, Postgres 16, Redis 7), `pnpm run setup`, `.env.example` documenté, rotation de `APP_ENCRYPTION_KEY`.
- Garde anti-SSRF, chiffrement AES-256-GCM des secrets, limites de débit partagées via Redis, gitleaks en pre-commit et en CI.

[Non publié]: https://github.com/pixelersagency/mynto/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pixelersagency/mynto/releases/tag/v0.1.0
