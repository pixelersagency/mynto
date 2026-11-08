# Style du tableau de bord (version finale)

Style « outil de travail » minimal : structure dense, composants sobres, adaptés aux audits.

Référence visuelle : le modèle de rapport par défaut « Minimaliste ». Le tableau de bord parle la même langue que le rapport : papier chaud, encre, serif éditoriale pour les titres et les grands chiffres.

## Ambiance

- Clair, minimal, dense et calme. Neutres chauds « papier » plutôt que des gris froids : la barre latérale et l'écran de connexion sur le papier (`--canvas`), le contenu sur des surfaces blanches.
- Une seule couleur d'accent : l'encre (`#141414`). Bouton principal en encre (texte blanc), liens en encre soulignés d'un filet chaud, focus en encre. Pas de bleu.
- Les groupes sont séparés par de l'espace, pas par des filets ni des cartes. Les filets chauds (`--border`) restent seulement entre les lignes d'un tableau ou d'une liste, et pour le cadre de l'application (barre du haut, barre latérale, barre d'onglets).
- Blocs doux (`.dash-block`, `--bg-subtle`, rayon 8 px, sans bordure) pour un contenu groupé : notes, encarts.
- Pas de pastilles pastel, pas de dégradés (ni sur les icônes de site, ni sur les avatars, ni sur le logo par défaut). Les favicons sont la seule couleur « décorative » ; sans favicon, l'initiale sur un carré neutre.
- Un état = un seul marqueur discret : un point de 6 px ou le mot en couleur, jamais une pilule remplie. L'état normal (terminé, envoyé, OK) reste en gris ; la couleur signale ce qui demande une action (échec, désactivé, en cours).
- Le score se lit en encre, précédé d'un petit carré à la couleur de sa bande.
- Barres de score fines (2 px) sur une piste chaude : encre quand le score est bon (80 et plus), `--warning` quand il demande de l'attention, toujours avec le chiffre et le mot de la bande à côté. Radar en trait d'encre avec un remplissage très léger.
- Mouvement seulement en réponse à une action (ouverture de la fiche, de la palette, vignette au survol). Rien ne flotte, ne respire ni n'apparaît en cascade.

## Typographie

- **Newsreader** (serif éditoriale, OFL, auto-hébergée dans `apps/web/public/fonts`) pour les titres de page (`.dash-display`, 30 px), les titres de section (`.dash-heading`, 20 px) et les grands chiffres (`.dash-num` : scores, indicateurs). Poids 400, interlettrage légèrement serré.
- **Inter** (auto-hébergée, 400 / 500 / 600 / 700) pour toute l'interface : texte, tableaux, champs, boutons. Échelle 11 / 12 / 13 / 14 / 16 px, chiffres tabulaires partout où il y a un nombre.
- Petites étiquettes en capitales (`.dash-label`, 11 px, interlettrage 0,08em, `--fg-muted`) pour les en-têtes de colonnes (appliqué à tout `thead th`), les groupes de la barre latérale et les titres de bloc de la fiche.
- Liens : `.dash-link` (encre, soulignement fin `--link-line`, soulignement plein au survol). La couleur seule ne distingue jamais un lien.
- Aucune police chargée depuis un CDN : les fichiers woff2 sont copiés depuis `@fontsource/*` par `apps/web/scripts/sync-fonts.mjs` (licences dans `public/fonts/LICENSES.txt`).

## Jetons (variables CSS, thème clair + thème sombre via « Apparence »)

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `--canvas` | `#F4F3EF` | `#12110F` | papier : barre latérale, connexion (classe `.dash-paper`) |
| `--bg` | `#FFFFFF` | `#1A1917` | surfaces : contenu, champs, menus |
| `--bg-subtle` | `#F7F6F2` | `#211F1C` | blocs doux, élément actif, survol de ligne |
| `--bg-hover` | `#F4F3EF` | `#262420` | survol des boutons secondaires |
| `--border` | `#EEEDE8` | `#2D2B27` | filets entre lignes et cadre |
| `--border-strong` | `#DAD8D0` | `#3D3B35` | bordure des champs, touches `kbd` |
| `--fg` | `#141414` | `#EDEBE4` | texte principal (encre / crème) |
| `--fg-muted` | `#6B6B66` | `#A8A59C` | métadonnées, étiquettes, compteurs |
| `--accent` / `--accent-fg` | `#141414` / `#FFFFFF` | `#EDEBE4` / `#141414` | bouton principal, case cochée, interrupteur |
| `--focus` | `#141414` | `#EDEBE4` | anneau de focus 2 px |
| `--link-line` | `#8A8A85` | `#8D8A81` | soulignement des liens (3:1 minimum, seul indice d'un lien) |
| `--success` / `--warning` / `--danger` | `#15803D` / `#C2410C` / `#B91C1C` | `#4ADE80` / `#FB923C` / `#F87171` | marqueurs de bande et d'état (point ou mot), jamais en fond |
| `--viz-1`, `--viz-mute-1`, `--viz-mute-2` | encre + deux gris chauds | crème + deux gris chauds | graphiques : une série en encre, le reste en gris (forme « emphase ») |
| `--viz-ord-1..3` | orange / gris / encre | orange / gris / crème | bandes de score : faible / moyen / bon |

Contrastes vérifiés (WCAG 2.2 AA) sur chaque surface (`--bg`, `--canvas`, `--bg-subtle`, `--bg-hover`, survol du papier) : `--fg-muted` 4,8:1 minimum en clair et 6,3:1 en sombre, `--success` 4,5:1 / 8,9:1, `--warning` 4,7:1 / 6,8:1, `--danger` 5,8:1 / 5,6:1, bouton principal 18,4:1 / 15,4:1, focus 18,4:1 / 14,7:1, contrôles non textuels (`--control`, `--viz-mute-1`) 3,1:1 minimum.

## Structure

1. **Barre latérale** (≈240 px, repliable, sur le papier, filet à droite)
   - En haut : logo + nom de l'agence avec chevron (configurable), bouton de repli.
   - Recherche avec raccourci `/`.
   - Liens principaux avec icônes fines et compteurs gris à droite : Accueil, Audits, Liens de suivi, Analytics, Activité.
   - Sections repliables en petites capitales grises (`.dash-label`) avec actions `…` et `+` : ex. VUES (vues enregistrées : En cours, Échecs, Radar, Ce mois-ci), CLIENTS ou PROJETS si on groupe les audits.
   - En bas : Apparence (clair/sombre), Réglages, Profil, puis puce utilisateur (nom de l'admin + `…`).
   - Fond papier (`--canvas`) ; élément actif : fond `--bg-subtle` (blanc sur le papier en clair), texte `--fg`, `aria-current="page"`.
2. **Barre du haut** : fil d'Ariane avec icônes (« Audits / Tous les audits ») + `…`. À droite : puce d'état « En ligne » (scanner et file opérationnels, verte) ou « Hors ligne », boutons secondaires discrets (ex. « Exporter », « API »).
3. **Barre de vues** : onglets de vues enregistrées avec icône (Tous, En cours, Échecs, Radar, Plus) + bouton « + Nouvelle vue ». À droite : Trier, Filtrer, loupe, bouton principal en encre « + Nouvel audit ».
4. **Tableau dense** (pas de cartes), en-têtes avec petite icône de type, cases à cocher pour actions groupées (rafraîchir, supprimer, exporter) :
   - **Site** (N) : favicon (ou initiale sur carré neutre) + nom du site + `…` (menu : ouvrir le rapport, PDF, copier le lien, rafraîchir, supprimer) ;
   - **Domaine** : lien souligné vers le rapport public ;
   - **Score** : chiffre en encre précédé d'un carré de 6 px à la couleur de la bande ;
   - **Statut** : le mot (Terminé en gris, En cours avec un point d'encre, Échec en rouge avec un point) ;
   - **Créé le** : date longue en français ;
   - **Axes** : 8 barres fines grises (hauteur = score) ; **Source** : texte gris (Tableau de bord, Radar, API, MCP) ;
   - **Ouvert** : « Oui », « 2 fois » ou « Pas encore » en gris, sans icône.
   - Lignes de 40-44 px, survol `--bg-subtle`, dernières lignes en fondu si la liste continue (pagination ou défilement infini).
5. **Analytics** dans le même langage : grands chiffres en serif sans cadre, puis graphiques fins séparés par de l'espace, une série en encre et le reste en gris (audits par semaine, score moyen par axe en barres de 2 px, taux d'ouverture des liens, problèmes les plus fréquents, coût LLM estimé). Titres de section en serif.
6. **Fiche audit** (panneau latéral) : nom du site en serif, grand score en serif avec le mot de la bande, radar en trait d'encre, blocs séparés par de l'espace avec un titre en petites capitales.

## Règles

- Accessibilité AA (c'est un outil d'audit) : contrastes vérifiés (attention aux gris clairs et aux pastels), focus visibles, tableau en vrai `<table>` avec en-têtes, navigation clavier dans les menus, jamais la couleur seule pour un statut.
- Responsive : barre latérale en tiroir sous 1024 px, tableau qui masque les colonnes secondaires puis passe en liste sous 640 px.
- Français, tutoiement, pas de tirets cadratins dans les textes d'interface.
