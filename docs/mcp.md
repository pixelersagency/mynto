# API publique et serveur MCP

Une instance mynto expose ses audits à tes propres outils de deux façons :

- une **API REST v1** sous `/api/v1` (JSON, clé Bearer) ;
- un **serveur MCP** pour Claude (Claude Code, Claude Desktop) et tout client MCP.

Les deux passent par la même couche de service que le tableau de bord (`apps/web/lib/services/audits.ts`) : mêmes contrôles d’URL, mêmes modules, mêmes données exposées. L’e-mail de contact, les données envoyées à l’IA (`llm_input`) et les clés ne sortent jamais.

## Clés API

Dans **Réglages > API et MCP** :

- **Créer** : donne un nom (l’outil qui l’utilise). La clé `myn_live_…` s’affiche **une seule fois**. Copie-la tout de suite.
- **Liste** : nom, préfixe (`myn_live_` + 8 caractères), date de création, dernier appel (précision d’une minute).
- **Révoquer** : immédiat, les appels suivants reçoivent `401`.

En base, seule l’empreinte SHA-256 de la clé est stockée (la clé fait 256 bits aléatoires), plus le préfixe. La comparaison se fait en temps constant. Chaque clé a sa propre limite : `API_RATE_LIMIT_PER_MINUTE` (120 par défaut, en mémoire, par processus web). Les échecs d’authentification sont limités par IP.

Une clé donne accès à toute l’instance (une agence = un admin). Garde-la côté serveur.

## API REST v1

Base : `<PUBLIC_URL>/api/v1`, en-tête `Authorization: Bearer myn_live_…`. Les erreurs sont toujours `{ "error": code, "message": texte }`.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/audits` | lance un audit `{ url, label?, modules?, site_type? }`, répond `202` avec `status: "queued"` |
| GET | `/audits` | liste paginée `?limit=1..100&offset=&status=in_progress\|completed\|failed\|expired&q=` |
| GET | `/audits/{id}` | un audit (un id remplacé par un rafraîchissement renvoie le scan courant) |
| POST | `/audits/{id}/refresh` | nouveau scan, mêmes modules, mêmes liens (`202`, ou `200` + `refreshed: false` si un scan tourne déjà) |
| DELETE | `/audits/{id}` | supprime le rapport, ses anciens scans, ses liens de suivi et ses captures |
| GET | `/audits/{id}/findings` | constats, P0 en premier (tests de préparation IA échoués inclus, axe `ia`) |
| GET | `/analytics/summary?days=7\|30\|90` | mêmes agrégats que la page Analytics |
| GET | `/templates` | modèles de rapport (fournis et de l’agence) |
| GET | `/templates/{id}` | manifest, fichiers et réglages d’un modèle |
| PUT | `/templates/{id}` | crée ou remplace un modèle de l’agence, seulement s’il passe la vérification (`422` + `issues` sinon) |
| POST | `/templates/{id}/preview` | rend un modèle (enregistré ou brouillon `files`) en document HTML, sur un audit ou l’exemple |
| GET | `/report-data/schema` | JSON Schema du contrat `report-data` v1 et données d’exemple |
| GET, POST | `/webhooks` | webhooks sortants : liste, création (secret renvoyé une fois) |
| GET, PATCH, DELETE | `/webhooks/{id}` | lire, modifier, supprimer un webhook |
| POST | `/webhooks/{id}/test` | envoie un `ping` |
| POST | `/webhooks/{id}/rotate-secret` | nouveau secret, renvoyé une fois |
| GET | `/webhooks/{id}/deliveries` | journal des livraisons (30 jours), détail et `…/{deliveryId}/resend` |

Chaque audit renvoie `report_url` (lien direct, jamais compté comme une ouverture) et `tracking_url` (le lien `/r/<token>` à envoyer au prospect). `score` est sur 100 et ne porte que sur les axes évalués ; un axe désactivé a `evaluated: false` et aucun score.

`ai_readiness` porte le module optionnel Préparation IA : `evaluated`, `score` sur 100, `level`, `site_type`, `included_in_global_score`, et sur `GET /audits/{id}` seulement le détail des 24 tests (`checks`). Voir [modules/ai-readiness.md](modules/ai-readiness.md).

`modules` (création) surcharge les réglages par défaut (Réglages > Modules d’audit) :

```json
{
  "url": "https://example.com",
  "label": "Client Martin",
  "modules": { "axes": ["seo_technique", "performance"], "vision": false, "ai_readiness": true },
  "site_type": "vitrine"
}
```

`site_type` (`auto`, `vitrine`, `contenu`, `app_api`, `ecommerce`) est un raccourci de `modules.site_type` pour les tests de préparation IA. `template` choisit le modèle du rapport (`minimal`, `bento`, `mynto` ou un modèle de l’agence ; les anciens `standard`, `compact` et `commercial` pointent vers `minimal`, `minimal` et `mynto`) ; chaque audit renvoie son `template` (`null` = modèle par défaut).

Description complète au format OpenAPI 3.1 : `GET /api/v1/openapi.json` (public). Une page de référence lisible est dans le tableau de bord : Réglages > API et MCP > Référence de l’API.

```sh
curl -H "Authorization: Bearer $MYNTO_API_KEY" "$MYNTO_URL/api/v1/audits?status=completed&limit=5"
```

## Serveur MCP

Outils (descriptions et schémas d’entrée Zod dans `packages/mcp/src/tools.ts`) :

| Outil | Rôle |
|---|---|
| `create_audit` | lance un audit (`url`, `label?`, `modules?`, `site_type?`) |
| `list_audits` | liste paginée, filtre par statut ou texte |
| `get_audit` | statut, score, scores par axe (axes non évalués marqués), préparation IA et ses 24 tests |
| `get_findings` | constats d’un audit terminé |
| `refresh_audit` | relance le scan, mêmes liens |
| `get_report_link` | lien de suivi + lien direct + état d’ouverture |
| `get_analytics_summary` | statistiques sur 7, 30 ou 90 jours |
| `list_templates` | modèles de rapport de l’instance |
| `get_template` | manifest, fichiers Liquid et CSS, réglages d’un modèle |
| `get_report_data_schema` | contrat `report-data` v1 (JSON Schema) et exemple complet |
| `preview_template` | rend un modèle (ou un brouillon) en HTML, sur un audit ou l’exemple, web ou PDF |
| `save_template` | enregistre un modèle de l’agence, seulement après la vérification |
| `list_webhooks` | webhooks sortants, dernier statut, échecs de suite |
| `create_webhook` | enregistre une adresse et ses événements, renvoie le secret une seule fois |
| `test_webhook` | envoie un `ping` à un webhook |

Créer un modèle avec un agent : voir [templates/README.md](templates/README.md). Webhooks : voir [webhooks.md](webhooks.md).

### HTTP (Streamable HTTP, sans état)

Point d’entrée : `POST <PUBLIC_URL>/mcp`, avec la même clé API en Bearer. Chaque requête est indépendante (pas de session, pas de flux SSE : `GET` et `DELETE` répondent `405`).

Claude Code :

```sh
claude mcp add --transport http mynto https://audit.agence.fr/mcp \
  --header "Authorization: Bearer myn_live_…"
```

### stdio (Claude Desktop, ou Claude Code en local)

Le paquet `packages/mcp` fournit le binaire `mynto-mcp`, qui parle à l’API REST de l’instance. Construis-le une fois :

```sh
pnpm install
pnpm --filter @mynto/mcp build   # écrit packages/mcp/dist/mynto-mcp.mjs (un seul fichier)
```

`claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "mynto": {
      "command": "node",
      "args": ["/chemin/vers/mynto/packages/mcp/dist/mynto-mcp.mjs"],
      "env": {
        "MYNTO_URL": "https://audit.agence.fr",
        "MYNTO_API_KEY": "myn_live_…"
      }
    }
  }
}
```

Claude Code en stdio :

```sh
claude mcp add mynto --env MYNTO_URL=https://audit.agence.fr --env MYNTO_API_KEY=myn_live_… \
  -- node /chemin/vers/mynto/packages/mcp/dist/mynto-mcp.mjs
```

Le binaire n’écrit que le protocole sur stdout ; ses messages vont sur stderr et n’affichent jamais la clé.

## Clés des fournisseurs d’IA

Dans **Réglages > IA** : fournisseur de rédaction (Anthropic par défaut, Gemini, Mistral), fournisseur d’analyse visuelle (Anthropic, Gemini), modèle par fournisseur, clés API.

- Les clés sont chiffrées en AES-256-GCM avec une clé dérivée (HKDF-SHA256) de `APP_ENCRYPTION_KEY` : 32 octets aléatoires en base64 ou hex, **même valeur** dans le web et le scanner (`openssl rand -base64 32`). Sans elle, le tableau de bord refuse d’enregistrer une clé.
- Le navigateur ne reçoit jamais la clé : seulement `sk-…abcd`. « Tester la connexion » fait un appel minimal côté serveur (Anthropic : Models API via le SDK officiel ; Gemini : lecture du modèle ; Mistral : liste des modèles), sans génération de texte.
- Sans clé enregistrée, le scanner utilise `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY` de son environnement. Il relit les réglages au début de chaque audit (cache de 30 s, `AI_CONFIG_CACHE_MS`).
- Changer `APP_ENCRYPTION_KEY` rend les clés enregistrées illisibles : le scanner le signale dans ses journaux et retombe sur l’environnement ; remplace les clés dans le tableau de bord.
