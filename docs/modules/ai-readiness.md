# Module Préparation IA (`ai_readiness`)

9e module de l’audit, optionnel. Il répond à une question : est-ce qu’un agent IA (ChatGPT, Claude, Perplexity, un agent de code ou d’achat) peut trouver le site, le lire et y agir ?

Repris de l’ancien « audit IA » de Mynto (`apps/scanner/src/audit-ai`), sans la marque ni l’appel commercial. Code : `apps/scanner/src/audit/ai-readiness/`, schémas : `packages/shared/src/schemas/ai-readiness.ts`.

## En bref

- 24 tests déterministes : requêtes HTTP, lecture de robots.txt, une requête DNS. Pas de LLM, pas de navigateur. Environ 20 secondes, en parallèle des collecteurs de l’audit 8 axes.
- Score à part, sur 100, et niveau de maturité de 0 à 5.
- Hors score global par défaut. Réglage d’instance « Inclure la préparation IA dans le score global » (désactivé par défaut).
- Activé par défaut sur une nouvelle installation. Une instance qui a déjà enregistré ses modules garde son choix. On le règle dans Réglages > Modules d’audit (défaut de l’instance), ou audit par audit dans Nouvel audit, l’API (`modules.ai_readiness`) et le serveur MCP.
- Module désactivé : rien ne change, le rapport, le score et les données sont ceux de l’audit 8 axes. La tuile « Préparation IA » affiche « Non évalué ».

## Les 24 tests

Poids : part du test dans le score. Un poids 0 est informatif.

### Découvrabilité

| Test | Ce qui est vérifié | Réussi si | Poids |
|---|---|---|---|
| `robots_txt` | `GET /robots.txt` | réponse 2xx, au moins une directive (`User-agent`, `Allow`, `Disallow`, `Sitemap`), pas servi en HTML | 3 |
| `sitemap` | sitemaps déclarés dans robots.txt (même domaine seulement), puis `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml` | un fichier contient `<urlset>` ou `<sitemapindex>` | 3 |
| `link_headers` | en-tête HTTP `Link` de la page auditée | relation utile à un agent : `alternate`, `describedby`, `service-desc`, `service-doc`, `api-catalog` | 2 |
| `dns_aid` | enregistrements SVCB et TXT sur `_index._agents`, `_mcp._agents`, `_a2a._agents` du domaine, via DNS over HTTPS (Cloudflare) | au moins un enregistrement. Résolveur injoignable : « Non testé », jamais un échec | 1 |

### Accès au contenu

| Test | Ce qui est vérifié | Réussi si | Poids |
|---|---|---|---|
| `markdown_negotiation` | la page avec `Accept: text/markdown`, puis les variantes `.md` (`/index.md`, `/page.md`, `/page/index.md`) | une réponse en Markdown | 3 |
| `llms_txt` | `/llms.txt` puis `/.well-known/llms.txt` | fichier non vide et pas en HTML (le message signale s’il manque un titre H1 ou des liens) | 2 |
| `no_js_content` | HTML brut de la page, sans exécuter le JavaScript | au moins 120 mots lisibles et pas de conteneur d’application vide (`#root`, `#app`, `#__next`, `#__nuxt`) | 3 |

### Contrôle des bots IA

| Test | Ce qui est vérifié | Réussi si | Poids |
|---|---|---|---|
| `ai_bot_rules` | blocs `User-agent` de robots.txt | au moins un bot IA cité (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot et 13 autres) | 3 |
| `content_signals` | lignes `Content-Signal` de robots.txt | au moins une ligne (`ai-train`, `search`, `ai-input`) | 2 |
| `web_bot_auth` | `/.well-known/http-message-signatures-directory` | annuaire publié. Absent : « Optionnel », hors score | 0 |
| `ai_bot_live_access` | la page demandée avec l’User-Agent du scanner suivi de `(simulating GPTBot)` puis `(simulating ClaudeBot)` | aucune réponse 401, 403, 405, 429 ou 5xx | 3 |

### Protocoles agents

Un document qui répond 200 mais n’est pas du JSON attendu (la page d’accueil d’une application monopage, par exemple) compte comme absent.

| Test | Ce qui est vérifié | Réussi si | Poids |
|---|---|---|---|
| `mcp_server_card` | `/.well-known/mcp/server-card.json`, `server-cards.json`, `/.well-known/mcp.json` | JSON avec `name`, `version`, `url`, `transport`, `endpoints` ou `servers` | 2 |
| `a2a_agent_card` | `/.well-known/agent-card.json`, `/.well-known/agent.json` | JSON avec `name`, `url`, `skills` ou `capabilities` | 1 |
| `agent_skills` | `/.well-known/agent-skills/index.json`, `/.well-known/skills/index.json` | JSON avec `skills`, `items` ou `name` | 1 |
| `webmcp` | HTML de la page | marqueurs WebMCP (`navigator.modelContext`, `provideContext(`, `registerTool(`, `type="application/mcp+json"`) | 1 |
| `api_catalog` | `/.well-known/api-catalog` (RFC 9727) | linkset JSON | 1 |
| `oauth_discovery` | `/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server` | JSON avec `issuer`, `authorization_endpoint` ou `token_endpoint` | 1 |
| `oauth_protected_resource` | `/.well-known/oauth-protected-resource` (RFC 9728), ou en-tête `WWW-Authenticate` avec `resource_metadata` | l’un des deux | 1 |
| `auth_md` | `/auth.md`, `/.well-known/auth.md` | fichier non vide, pas en HTML | 1 |
| `ard_manifest` | `/.well-known/ai-catalog.json`, `/.well-known/ard.json` | JSON avec `resources`, `catalog` ou `name` | 1 |

### Commerce agentique

| Test | Ce qui est vérifié | Réussi si | Poids |
|---|---|---|---|
| `x402` | `/api`, `/api/v1`, puis la page | réponse 402, en-têtes `X-Payment` / `X-Accept-Payment`, ou corps x402 | 1 |
| `mpp` | `/.well-known/mpp.json`, `/openapi.json` | mention d’un paiement marchand MPP | 1 |
| `ucp` | `/.well-known/ucp`, `/.well-known/ucp.json` | document non vide, pas en HTML | 1 |
| `acp` | `/.well-known/acp.json` | objet JSON | 1 |

Chaque test échoué porte un correctif en français, prêt à coller dans un agent de code, et ses preuves (URL, statut HTTP, extrait). Les extraits sont nettoyés des caractères de contrôle et limités à 160 caractères.

## Type de site

Le type décide quels tests comptent. Un site vitrine n’est testé ni sur les API, ni sur l’authentification, ni sur le paiement.

| Type | Tests appliqués | Niveau maximum |
|---|---|---|
| `vitrine` (présentation, services, contact) | découvrabilité, accès au contenu, bots IA (11 tests) | 3 |
| `contenu` (blog, média, documentation) | les 11 + `agent_skills`, `ard_manifest` | 3 |
| `app_api` (SaaS, application, API) | les 13 + `mcp_server_card`, `a2a_agent_card`, `webmcp`, `api_catalog`, `oauth_discovery`, `oauth_protected_resource`, `auth_md` | 4 |
| `ecommerce` (boutique) | les 24 | 5 |

Les tests hors périmètre sont rapportés « Non applicable » (statut `neutral`, `applicable: false`), ne sont pas lancés et sortent du score.

Choix du type : au lancement de l’audit (Nouvel audit, `site_type` de l’API, paramètre `site_type` de l’outil MCP `create_audit`), ou par défaut dans Réglages > Modules d’audit. La valeur `auto` (par défaut) lance la détection reprise de l’original, sur le HTML de la page d’accueil. Il faut deux signaux indépendants d’une même famille, testées dans cet ordre :

- e-commerce : `schema:Offer`, `schema:Product`, lien panier/checkout, WooCommerce, Shopify, prix en euros ;
- application ou API : liens connexion, inscription, documentation d’API, `schema:SoftwareApplication` ;
- contenu : lien blog/actualités, `schema:Article`, flux RSS ou Atom.

Sinon, ou si la page ne répond pas : `vitrine`. Le rapport indique si le type a été détecté ou choisi, et les signaux retenus sont stockés (`site_type_signals`).

## Score et niveau

Score = somme des poids des tests réussis / somme des poids des tests réussis ou échoués, arrondi, sur 100. Les tests `neutral` (optionnels ou hors périmètre) et `skipped` (sonde impossible) sortent du calcul : une sonde qui ne répond pas ne fait jamais perdre de points.

Niveau de maturité, atteint seulement si tous les niveaux inférieurs le sont, plafonné par le type de site :

| Niveau | Nom | Condition |
|---|---|---|
| 0 | Invisible | |
| 1 | Présence de base | `robots_txt` et `sitemap` |
| 2 | Prêt pour les robots d’IA | `ai_bot_rules` et `content_signals` |
| 3 | Lisible par les agents | `no_js_content`, `ai_bot_live_access`, et `markdown_negotiation` ou `llms_txt` |
| 4 | Interopérable | un de `mcp_server_card`, `a2a_agent_card`, `agent_skills`, `api_catalog`, `webmcp` |
| 5 | Transactionnel | un de `x402`, `mpp`, `ucp`, `acp` |

Site injoignable (ni la page ni robots.txt ne répondent) : le module est enregistré en échec (`status: "failed"`, `error: "site_unreachable"`), sans score. Un 0 dirait à un site sain qu’il est invisible.

### Score global

Par défaut le score global reste la moyenne pondérée des 8 axes : les scores d’une instance restent comparables, avec ou sans le module.

Avec « Inclure la préparation IA dans le score global » (Réglages > Modules d’audit), la note IA (sur 10) entre dans la moyenne avec un poids de 1,0 (les axes pèsent de 0,6 à 1,2). Le réglage est copié dans les modules de l’audit à sa création : changer le réglage ne modifie pas les audits déjà faits. Un audit dont le module a échoué n’intègre rien. Le rapport et l’API indiquent `included_in_global_score`.

## Données

Migration `0007_ai_readiness.sql` sur `audits_full` :

- `ai_readiness jsonb` : résultat complet (`version`, `status`, `score`, `level`, `site_type`, `site_type_auto`, `site_type_signals`, `included_in_global_score`, `error`, `checks`). NULL quand le module n’a pas tourné ;
- `ai_score smallint` (0 à 100) : copie du score pour le tri, le filtre et les agrégats.

Les deux colonnes sont publiques (rapport `/audit/full`, `/r/`, PDF) : elles ne contiennent que ce que le site audité sert à tout le monde. L’e-mail, `llm_input` et `source` restent privés.

Modules de l’audit (`audits_full.modules`, `audit_settings.modules`) : trois clés ajoutées, lues avec leur valeur par défaut sur les lignes plus anciennes : `ai_readiness` (false pour une ligne enregistrée sans la clé ; true pour une installation sans réglage enregistré), `site_type` (`auto`), `ai_in_global_score` (false).

Les tests ne créent pas de lignes dans `audit_findings_full` : le chiffrage, l’arbitrage et la liste des constats par axe ne bougent pas. L’API les expose comme constats virtuels (voir plus bas).

## Où on le voit

- Rapport web (`/audit/full/<slug>` et `/r/<token>`) : tuile « Préparation IA » sous les 8 axes (ou « Non évalué »), puis la section « Préparation IA » : un bloc par catégorie, chaque test avec son statut (Réussi, À corriger, Optionnel, Non testé), ce qui a été mesuré, ce que vérifie le test, le correctif et les preuves. Les tests hors périmètre sont listés à part.
- PDF : la section « Préparation IA » du modèle de rapport (mêmes données, dépliée).
- Tableau de bord : colonne « IA » (score sur 100, « - » si non évalué), filtre « Préparation IA faible » (score sous 50, `?ia=faible`).
- Analytics : score IA moyen, nombre d’audits sous 50, tests les plus échoués.
- API v1 et MCP : `ai_readiness` dans chaque audit (`evaluated`, `score`, `level`, `level_name`, `site_type`, `site_type_auto`, `included_in_global_score`), le détail des 24 tests (`checks`) sur `GET /audits/{id}` et `get_audit`. Les tests échoués applicables sont ajoutés à `GET /audits/{id}/findings` et `get_findings` avec `axis: "ia"`, `rule_code: "ia.<test>"`, une sévérité tirée du poids (3 : P1, 2 : P2, sinon P3) et le correctif en `recommendation`. `get_analytics_summary` et `/analytics/summary` ont un bloc `ai_readiness`.
- CLI : `pnpm tsx apps/scanner/src/audit/cli.ts <url> --ai[=type]`.

## Sécurité et réseau

- Toutes les requêtes vers le site passent par `safeFetch` : URL vérifiée à chaque redirection, adresses privées refusées, adresse IP épinglée (pas de DNS rebinding), corps limité (512 Ko, 64 Ko pour les tests de bots).
- Les sitemaps déclarés hors du domaine audité ne sont jamais téléchargés.
- User-Agent : celui du scanner (`AUDIT_USER_AGENT`, ou `MyntoAudit/<version>` avec l’adresse de l’instance). Le test d’accès réel ajoute « simulating GPTBot » : le scanner ne se fait jamais passer pour un vrai robot.
- Seule requête hors du site : la recherche DNS-AID chez `cloudflare-dns.com` (DNS over HTTPS), qui ne transmet que le nom de domaine.
- Aucun appel LLM. Les résultats ne sont pas envoyés à la rédaction IA du rapport.

## Limites

Ces standards sont jeunes et changent. Un bon score dit que le site expose les signaux attendus, pas qu’un assistant le citera. WebMCP vit dans le JavaScript de la page : sans navigateur, seuls ses marqueurs sont visibles.
