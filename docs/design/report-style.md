# Style du rapport d'audit

Le rapport (`/audit/full/[slug]`, `/r/[token]`, PDF) adopte le même langage que le tableau de bord ([dashboard-style.md](dashboard-style.md)) : blanc, typo type Inter, filets fins, peu d'ombres. L'identité visuelle vient de l'agence (logo, nom, couleur principale des réglages « Marque ») : la couleur de l'agence remplace le bleu d'accent. Plus de fond beige ni de titres en serif.

## Principes

- **Synthèse d'abord, détail replié.** Un dirigeant doit comprendre l'essentiel en 30 secondes sans défiler loin.
- **Score sur 100 partout** (rapport, PDF, dashboard, API). Bandes : 80-100 bon, 50-79 à améliorer, 0-49 critique. Les axes désactivés affichent « Non évalué », jamais 0.
- **Pas de boutons de partage réseaux sociaux.** Actions : « Télécharger le PDF » et « Copier le lien ».
- **CTA de l'agence** visible mais sobre, seulement si `contact_url` est renseigné.

## Structure de la page

1. **En-tête** : logo + nom de l'agence à gauche, « Audit web » + date à droite. Mention de suivi discrète sous l'en-tête sur `/r/`.
2. **Bloc résumé** (carte unique, pleine largeur) :
   - à gauche : score global /100, grand chiffre + bande (pastille) ;
   - à droite : URL auditée, secteur, stack détectée, date d'expiration ; compteurs de problèmes par priorité (P0, P1, P2) en pastilles ;
   - actions : Télécharger le PDF, Copier le lien.
3. **Résumé exécutif** : 3 à 5 lignes, texte de la synthèse.
4. **Top 3 priorités** : trois cartes alignées (titre, pourquoi ça compte, problèmes liés).
5. **Chiffrage** (si présent) : estimation en jours et en euros selon le taux de l'agence, avec la mention « indicatif ». Option correction ou refonte si l'arbitrage l'indique.
6. **Scores par axe** : grille de 8 tuiles compactes (nom, score /100, petite barre, nombre de problèmes), chaque tuile ancre vers sa section.
7. **Problèmes par axe** : une section repliable par axe (`<details>`/disclosure accessible), fermées par défaut sauf celles qui ont des P0. Dans chaque section, les problèmes triés par priorité : titre, constat, impact business, recommandation, extrait de code repliable, références légales en pastilles, URLs concernées.
8. **Ce qui va bien** : liste courte des contrôles réussis, repliée.
9. **Pied de page** : texte de pied de l'agence, mention « rapport automatisé, indicatif », date d'expiration.

## PDF

Même structure et mêmes jetons, adaptés à l'impression : A4, marges 16 mm, sections dépliées, sauts de page avant chaque axe, en-tête et pied de page de l'agence sur chaque page, liens visibles en clair. Pas de couleurs de fond pleines lourdes.

## Personnalisation par l'agence (Réglages)

### Polices
- Choix de la police des titres et de celle du texte dans une liste courte, embarquée dans l'app (fichiers woff2 servis localement, aucun appel à Google Fonts) : Inter, Plus Jakarta Sans, Manrope, DM Sans, IBM Plex Sans, Source Serif 4, Fraunces, Merriweather.
- Ou import d'une police personnalisée (woff2, ≤ 500 Ko par fichier, regular + bold), stockée via MediaStorage et servie en `@font-face` local.
- Appliquées au rapport web et au PDF. Repli système si un fichier manque.

### Modèles de rapport multiples et extensibles

Fonctionnement inspiré des plugins de factures : des thèmes fournis, et un format ouvert que l'agence (ou son agent IA) peut dupliquer et adapter.

- **Format d'un modèle** : un dossier `templates/<id>/` avec `manifest.json` (id, nom, version, version du contrat de données, réglages exposés avec leur schéma), `report.liquid` (+ partiels `sections/*.liquid`), `report.css`, `print.css` optionnel, `preview.png`. Langage de gabarit sans code exécutable (Liquid via `liquidjs`, en mode strict, sans accès au système de fichiers hors du dossier du modèle) : un modèle importé ne peut pas exécuter de code serveur.
- **Contrat de données** versionné (`report-data` v1) : un objet JSON unique (audit, scores, axes, problèmes, chiffrage, agence, réglages du modèle, textes), décrit par un schéma Zod exporté en JSON Schema dans `docs/templates/report-data.schema.json`, avec un exemple complet `docs/templates/example-data.json`.
- **Modèles fournis** (v2) : « Minimaliste » (`minimal`, défaut : noir sur blanc, serif, blocs papier), « Bento » (`bento` : tuiles zinc monochromes), « Style Mynto » (`mynto` : bordeaux et crème, accent pêche). Ils remplacent Standard, Compact et Commercial (`standard`, `compact` → `minimal`, `commercial` → `mynto`, voir [templates/README.md](../templates/README.md)) et servent aussi de base à dupliquer.
- **Dans le tableau de bord** : galerie des modèles (aperçu, activer, définir par défaut, dupliquer, exporter en .zip, importer un .zip validé, supprimer). Réglages propres à chaque modèle (polices, sections, textes) générés depuis son manifest. Choix du modèle au lancement d'un audit, modifiable ensuite.
- **Pour un agent IA** :
  - `docs/templates/README.md` : guide pour créer un modèle (contrat de données, filtres disponibles, contraintes d'accessibilité, impression) ;
  - commande `pnpm template:new <id> --from minimal` puis `pnpm template:preview <id>` (aperçu local sur les données d'exemple, rechargement à chaud) et `pnpm template:check <id>` (validation du manifest, rendu sans erreur, contrôles d'accessibilité automatiques axe-core, test d'impression PDF) ;
  - outils MCP : `list_templates`, `get_template`, `get_report_data_schema`, `preview_template` (rend un modèle sur un audit et renvoie le HTML ou une capture), `save_template` (crée ou met à jour un modèle après validation par `template:check`) ;
  - le rapport et le PDF passent par le même moteur de rendu, donc un modèle validé fonctionne pour les deux.
- **Sécurité** : modèles importés validés (taille ≤ 2 Mo, extensions autorisées, CSS sans `@import` externe ni URL distante sauf polices locales), sortie HTML échappée par défaut, CSP inchangée.

### Réglages du modèle actif
- Page « Modèle de rapport » avec aperçu en direct sur un audit exemple.
- Sections : activer/désactiver et réordonner (résumé exécutif, top 3, chiffrage, scores par axe, problèmes, ce qui va bien, CTA).
- Textes personnalisables : introduction affichée sous l'en-tête, titre et texte du CTA, pied de page, mention de suivi (dans une limite qui garde l'information obligatoire).
- Options : sections de problèmes ouvertes ou fermées par défaut, afficher ou non les extraits de code, densité (aérée / compacte).
- PDF : page de couverture optionnelle (logo, titre, site audité, date), en-tête et pied de page de l'agence.
- Un seul modèle par installation pour commencer, stocké en base (JSON validé par Zod, versionné). Bouton « Revenir au modèle par défaut ».

## Envoi par email (SMTP de l'agence)

- Réglages « Email » : hôte, port, sécurité (TLS/STARTTLS), utilisateur, mot de passe chiffré en base (même mécanisme que les clés IA, `APP_ENCRYPTION_KEY`), nom et adresse d'expéditeur, adresse de réponse. Bouton « Envoyer un email de test ».
- Dans le tableau de bord : action « Envoyer le rapport » sur un audit terminé. Destinataire saisi à l'envoi, objet et message pré-remplis depuis un modèle éditable (variables : `{site}`, `{score}`, `{lien}`, `{agence}`). Le lien envoyé est le lien de suivi `/r/`.
- Journal des envois (date, destinataire, statut) visible sur l'audit. L'adresse du destinataire n'est jamais exposée publiquement ni dans l'API publique sans clé.
- Mention dans le modèle par défaut : identité de l'agence et moyen simple de ne plus être contacté (prospection B2B).
- Envoi via nodemailer depuis le serveur uniquement. Rien n'est envoyé si le SMTP n'est pas configuré (action grisée avec explication).

## Accessibilité et responsive

- AA vérifié avec la couleur de l'agence : si le contraste de la couleur choisie est insuffisant sur blanc, utiliser une variante assombrie automatiquement pour le texte et les liens.
- Titres hiérarchisés (un seul `h1`), sections repliables utilisables au clavier, statut et priorité jamais portés par la couleur seule.
- Mobile : blocs en pile, tuiles d'axes en 2 colonnes, tableaux remplacés par des listes.
- Français, tutoiement, pas de tirets cadratins.
