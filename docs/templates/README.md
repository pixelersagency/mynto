# Créer un modèle de rapport

Ce guide s’adresse à un humain comme à un agent IA (Claude Code, un client MCP). Il suffit pour écrire un modèle qui passe la vérification du premier coup.

Un modèle décide de l’allure du rapport : la page web (`/audit/full/<slug>`, `/r/<jeton>`) **et** le PDF. Les deux passent par le même moteur. Un modèle validé fonctionne donc pour les deux.

## En bref

1. Pars d’un modèle fourni : `pnpm template:new mon-modele --from minimal` (ou `bento`, `mynto` ; crée `templates/mon-modele/`, ignoré par git).
2. Lis le contrat de données : [`report-data.schema.json`](report-data.schema.json) et l’exemple complet [`example-data.json`](example-data.json).
3. Modifie le Liquid et le CSS, regarde le résultat : `pnpm template:preview mon-modele` (http://127.0.0.1:4310, `?mode=print` pour le PDF, rechargement automatique).
4. Vérifie : `pnpm template:check mon-modele` (manifest, rendu, axe-core sur ordinateur et mobile, impression PDF). Ajoute `--update-preview` pour régénérer `preview.png`.
5. Installe-le : zip du dossier importé dans Réglages > Modèles de rapport, ou outil MCP `save_template`, ou `PUT /api/v1/templates/<id>`.

## Les modèles fournis

| id | Nom | En deux mots |
|---|---|---|
| `minimal` | Minimaliste (défaut) | Noir sur blanc, titres en Source Serif 4, beaucoup d’air. Pas de filet entre les sections : des blocs papier clairs (`#F7F6F2`, rayon 8 px) regroupent les éléments ; filets seulement dans les listes (plan, tests IA). PDF blanc. |
| `bento` | Bento | Tuiles monochromes (zinc), titres en Manrope. La couleur de l’agence reste discrète (repère d’en-tête, bouton principal, liens). PDF blanc, tuiles cernées d’un filet. |
| `mynto` | Style Mynto | Bordeaux et crème de mynto.fr, accent pêche `#E9B48A` ou couleur de l’agence (réglage « Couleur d’accent », éclaircie si besoin pour rester lisible sur le fond sombre). PDF : couverture sombre, corps clair (accent bordeaux ou couleur de l’agence assombrie). |

Les trois ont le même contenu : ouverture (score global, bande, phrase de synthèse, radar des 8 axes, « En bref », « Corriger l’essentiel », boutons), puis les sections réordonnables (chiffrage, plan d’action, diagnostic, scores par axe, préparation IA, problèmes par axe, ce qui va bien, appel à l’action), pied de page (mentions, validité, confidentialité). Mêmes réglages : sections, textes, « Ce que tu proposes », ouverture des problèmes, extraits de code, capture du site, densité, couverture PDF, polices. Les polices de titre par défaut sont celles du modèle (Source Serif 4, Manrope, celle de Réglages pour Style Mynto) : choisis « Celle de Réglages, Polices » pour ta police de marque.

**Anciens modèles.** `standard`, `compact` et `commercial` (avant la v2) sont retirés. Leurs id restent réservés et pointent vers le remplaçant : `standard` et `compact` → `minimal`, `commercial` → `mynto`. La migration `0010_report_templates_v2.sql` réécrit les id enregistrés (audits, modèle par défaut, réglages) ; le code fait la même correspondance au rendu pour tout ce qui l’aurait manquée. Les réglages compatibles (sections, textes, ouverture des problèmes, extraits de code, densité, polices) sont repris tels quels.

## Le dossier d’un modèle

```
mon-modele/
  manifest.json        identité, version, contrat visé, réglages exposés
  report.liquid        point d’entrée
  sections/*.liquid    partiels (ou partials/*.liquid)
  report.css           styles écran
  print.css            styles d’impression (optionnel)
  preview.png          vignette de la galerie (optionnel, PNG, 1 Mo maximum)
```

Rien d’autre n’est accepté (pas de JS, pas d’image, pas de police). Archive importée : 2 Mo maximum, un seul dossier racine toléré.

### manifest.json

```json
{
  "id": "mon-modele",
  "name": "Mon modèle",
  "description": "Une phrase pour la galerie.",
  "version": "1.0.0",
  "contract": { "name": "report-data", "version": 1 },
  "based_on": "minimal",
  "settings": [
    { "key": "sections", "type": "sections", "label": "Sections", "default": [{ "id": "summary", "enabled": true }] },
    { "key": "cta_title", "type": "text", "label": "Titre de l’appel à l’action", "max": 80, "default": "On en parle ?" },
    { "key": "density", "type": "select", "label": "Densité", "options": [{ "value": "airy", "label": "Aérée" }, { "value": "compact", "label": "Compacte" }], "default": "airy" },
    { "key": "show_code", "type": "boolean", "label": "Afficher les extraits de code", "default": true },
    { "key": "heading_font", "type": "font", "label": "Police des titres", "default": "inherit" }
  ]
}
```

- `id` : minuscules, chiffres, tirets, 2 à 40 caractères. `minimal`, `bento`, `mynto` (et les anciens `standard`, `compact`, `commercial`) sont réservés.
- Types de réglages : `boolean`, `select`, `text`, `textarea` (avec `max`), `font` (`inherit` = Réglages > Polices), `sections` (ordre et activation des sections).
- Le tableau de bord génère le formulaire depuis ce tableau. Les valeurs arrivent dans `settings.<key>`.
- Clés reconnues par le moteur : `intro`, `cta_title`, `cta_text`, `cta_label`, `footer_text` (remplissent `texts`), `open_issues` (`p0`, `all`, `none` : ouverture des sections de problèmes), `show_code` (`false` vide `code`), `heading_font`, `body_font`.

## Le contrat `report-data` v1

Le modèle reçoit un seul objet. Pas de base, pas de fichier, pas de réseau. Points clés :

- **Toutes les clés sont toujours présentes.** Une valeur absente vaut `null` ou `[]`. Teste `{% if cost %}`, jamais l’existence d’une clé (les variables sont strictes : une faute de frappe fait échouer le rendu, c’est voulu).
- **Scores entiers sur 100.** Bandes : 80-100 `good` (« Bon »), 50-79 `fair` (« À améliorer »), 0-49 `poor` (« Critique »). Un axe non évalué a `evaluated: false` et `score.value: null` : affiche « Non évalué », jamais 0.
- `mode` : `web` ou `print`. En `print`, `open_by_default` est vrai partout ; masque les boutons.
- `axes[]` : les 8 axes dans l’ordre du rapport, chacun avec `findings[]` (déjà triés P0 → P3) et `passed[]`.
- `ai` : la Préparation IA (`evaluated`, `failed`, `score`, `level`, `max_level`, `categories[].checks[]`, `top_fixes[]`). Traite-la comme une section à part entière, avec un état « Non évalué ».
- `cost` : chiffrage indicatif ou `null`. Écris toujours qu’il est indicatif.
- `agency` : `name`, `logo_url`, `contact_url`, `color` (choisie) et `color_text` (assombrie si besoin pour 4,5:1 sur blanc), `on_color` (texte lisible sur la couleur).
- `links.share_url` : le lien à copier (lien de suivi sur `/r/`). `links.pdf_url` : le PDF.
- `tracking.enabled` : vrai sur un lien de suivi. Affiche alors `tracking.notice` près de l’en-tête et un paragraphe « Confidentialité » avec `id="confidentialite"`.
- `sections[]` : l’ordre choisi par l’agence. Boucle dessus avec un `case` sur `section.id` (`summary`, `priorities`, `cost`, `axes`, `ai`, `issues`, `passed`, `cta`).

## Liquid

[LiquidJS](https://liquidjs.com/) en mode strict, avec les tags et filtres standard. Partiels : `{% include 'sections/header' %}` (nom **entre guillemets**, fichier du modèle uniquement ; `include` partage les variables). `layout` n’est pas pris en charge.

Filtres ajoutés :

| Filtre | Exemple | Résultat |
|---|---|---|
| `fr_number: n` | `{{ 2430 \| fr_number }}` | `2 430` |
| `euros` | `{{ 600 \| euros }}` | `600 €` |
| `band` / `band_label` | `{{ 58 \| band }}` | `fair` / `À améliorer` |
| `ring_dash: rayon` | `stroke-dasharray="{{ score.value \| ring_dash: 52 }}"` | anneau SVG rempli au score |
| `pct: total` | `{{ 3 \| pct: 12 }}` | `25` |
| `plural: un, plusieurs` | `{{ n \| plural: 'problème', 'problèmes' }}` | accord |
| `date_fr` | `{{ audit.created_at \| date_fr }}` | `2 novembre 2026` |
| `initial`, `anchor` | | première lettre, ancre HTML |
| `radar_ring: n, rayon, centre` | `points="{{ 50 \| radar_ring: axes.size, 118, 180 }}"` | polygone régulier à 50 % du rayon (grille) |
| `radar_points: rayon, centre` | `points="{{ axes \| radar_points: 118, 180 }}"` | polygone des scores ; un axe non évalué est au centre (écris « – » dans son libellé, jamais un score) |
| `radar_x` / `radar_y: i, n, rayon, centre` | `x="{{ 117 \| radar_x: forloop.index0, axes.size, 118, 180 }}"` | coordonnée du rayon `i` sur `n` à `valeur` % du rayon (au-delà de 100 pour les libellés) |
| `radar_anchor: n` | `text-anchor="{{ forloop.index0 \| radar_anchor: axes.size }}"` | `start`, `middle` ou `end` selon la position du libellé |

Un radar est une image : mets le SVG en `aria-hidden="true"` et donne les valeurs en texte (par exemple un `<figcaption>` masqué visuellement), comme dans `minimal/sections/radar.liquid`.

Toute sortie est échappée. `raw` échappe aussi : les données viennent de sites audités et ne sont jamais du HTML de confiance.

## HTML

- Un seul `h1` (le titre du rapport), puis une hiérarchie sans saut de niveau.
- Pas de `<main>` (la page le fournit), pas de `<script>`, `<style>`, `<iframe>`, `<form>`, `<link>`, `<meta>`, pas d’attribut `on…`, pas d’URL `javascript:`. Le rendu passe ensuite par une liste blanche : ce qui n’y est pas disparaît.
- Images : seulement des chemins de l’instance (`agency.logo_url`, `audit.hero_image_url`). Une image distante est supprimée. Toujours un `alt`.
- Sections repliables : `<details>` + `<summary>` (clavier natif).
- Bouton « Copier le lien » : `<button type="button" data-mynto-action="copy" data-mynto-value="{{ links.share_url }}" data-mynto-done="Lien copié"><span data-mynto-label>Copier le lien</span></button>`. La page fournit le comportement.
- Styles en ligne limités à `width`, `height` et aux variables `--pct`, `--value`, `--i`, `--tone`.
- Priorité et statut jamais portés par la couleur seule : forme (icône, triangle, losange) + texte.

## CSS

- Le moteur imbrique `report.css` dans `.mynto-report { … }` et `print.css` dans `@media print { .mynto-report { … } }`. Utilise `&` pour la racine du rapport. Tes règles ne touchent rien hors du rapport.
- Interdits : `@import`, `url()`, `@font-face`, `@page`. Le moteur fournit les polices et la page A4 (marges 16 mm, pied de page de l’agence et numéro de page).
- Variables fournies : `--mr-brand`, `--mr-brand-text` (liens, textes colorés sur fond clair, 4,5:1 sur blanc ; un bouton plein sûr : fond `--mr-brand-text`, texte blanc), `--mr-brand-on-dark` (la couleur éclaircie si besoin pour 4,5:1 sur un fond sombre, `#27272a` ou plus foncé), `--mr-on-brand`, `--mr-brand-soft`, `--mr-brand-line`, `--mr-font-heading`, `--mr-font-body`.
- La couleur de l’agence sert d’accent (filets, anneau, bouton principal), pas d’aplat.
- `@keyframes` permis au premier niveau ; anime seulement sous `@media (prefers-reduced-motion: no-preference)`.
- Mobile d’abord : pas de défilement horizontal à 390 px, tuiles d’axes sur 2 colonnes.

### Impression

- `break-before: page` avant chaque axe si tu veux une page par axe ; `break-inside: avoid` sur les cartes.
- Masque les boutons. Les liens externes peuvent afficher leur URL : `a[href^='http']::after { content: ' (' attr(href) ')'; }`.
- Page de couverture : section affichée seulement si `mode == 'print'` et un réglage `pdf_cover`.

## Vérification

`pnpm template:check <id>` échoue si :

- un fichier n’est pas autorisé, le manifest est invalide, le CSS ou le HTML contient un élément interdit, un partiel est introuvable ;
- le rendu échoue sur les données d’exemple en mode web ou print ;
- la structure n’est pas accessible (pas exactement un `h1`, image sans `alt`, lien ou bouton sans nom, `<details>` sans `<summary>`) ;
- axe-core trouve une violation grave ou critique (WCAG 2.1 A et AA), sur ordinateur (1280 px) ou mobile (390 px) ;
- la page déborde horizontalement, ou l’impression PDF est vide.

`save_template` (MCP) et `PUT /api/v1/templates/<id>` refont la partie sans navigateur avant d’enregistrer : un modèle refusé renvoie `saved: false` et la liste des problèmes.

## Avec un agent IA (MCP)

1. `list_templates`, puis `get_template` sur `minimal` (ou `bento`, `mynto`) pour récupérer ses fichiers.
2. `get_report_data_schema` pour le contrat et l’exemple.
3. Modifie les fichiers, change `manifest.json` (`id`, `name`, `based_on`).
4. `preview_template` avec `files` (brouillon non enregistré), `mode: "print"` pour le PDF, `audit_id` pour un vrai audit.
5. `save_template` quand le rendu te convient. Puis active le modèle ou rends-le défaut dans la galerie.
