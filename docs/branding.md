# Marque de l'agence

Tout se règle dans **Réglages > Marque** du tableau de bord. Les valeurs `AGENCY_*` du `.env` servent seulement de valeurs par défaut tant que le formulaire n'a jamais été enregistré.

| Réglage | Où il apparaît |
|---|---|
| Nom, site, lien de contact, couleur, pied de page, taux journalier | Rapports web et PDF, aperçu de partage, tableau de bord |
| Logo (PNG ou JPEG, 512 Ko max., SVG refusé) | En-tête des rapports et du PDF, tableau de bord, page de connexion |
| Favicon (PNG, SVG ou ICO, 256 Ko max.) | Icône d'onglet de toutes les pages de l'instance |

## Favicon

Le favicon s'applique à toutes les pages servies par l'instance : tableau de bord, connexion, rapports publics (`/audit/full/...`, `/r/...`) et vue PDF.

Ordre de repli :

1. le favicon envoyé dans Réglages > Marque ;
2. sinon le logo de l'agence (« Utiliser le logo », l'état par défaut). Un logo large est centré sur un carré transparent, sans déformation ;
3. sinon l'icône Mynto par défaut.

Le bouton **Retirer** supprime le favicon envoyé et revient au logo.

Conseils :

- image carrée, 512 x 512 pixels recommandés (2048 x 2048 maximum pour un PNG) ;
- PNG pour un rendu sûr partout ; SVG pour une icône nette à toutes les tailles ; ICO si tu as déjà un `favicon.ico` multi-tailles.

Le type est vérifié sur le contenu du fichier, pas sur son extension. Un SVG est refusé s'il contient un script, un attribut d'événement (`onload`...), un `foreignObject`, une image, un lien, une animation, une référence externe (`href` autre qu'une ancre `#id`, `url()` CSS externe, `@import`) ou un DOCTYPE. Le fichier stocké est exactement celui qui a été vérifié. Exporte un SVG simple (optimisé) si le tien est refusé.

### Icône pour écran d'accueil (iOS)

Le lien `apple-touch-icon` (PNG 180 x 180 sur fond blanc) vient d'un favicon PNG, sinon du logo. Avec un favicon SVG ou ICO et sans logo, aucun lien n'est émis (iOS prend alors une capture de la page).

### Côté technique

- Fichiers : dans `MEDIA_DIR`, à côté du logo (`brand/favicon-<aléatoire>.png|svg|ico`). La clé est en base dans `agency_settings.favicon_key` (migration `0011_agency_favicon.sql`). Les sauvegardes existantes (base + volume des médias) le couvrent.
- Routes publiques : `/media/brand/favicon` (favicon effectif) et `/media/brand/apple-icon`. Les pages les lient avec `?v=<version>` : cette URL change à chaque nouveau favicon ou logo, elle est donc mise en cache un an (`immutable`). Sans version ou avec une version périmée, le cache est de 5 minutes.
- Réponses : `Content-Type` fixé par le serveur, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` (posée par le middleware sur toutes les routes `/media/`), `Cross-Origin-Resource-Policy: same-origin`. La CSP des pages ne change pas (`img-src 'self'`).
- Validation SVG : un vrai découpage des balises (attributs entre guillemets obligatoires, commentaires retirés, pas de CDATA, seules les 5 entités XML prédéfinies), puis liste blanche d'éléments et contrôle de chaque attribut.
- Le recadrage carré utilise `next/og`, déjà présent pour les images de partage (aucune dépendance ajoutée). Un logo de plus de 2048 pixels de côté n'est jamais décodé : il est servi tel quel.
- Le favicon n'est pas exposé par l'API REST v1 ni par le serveur MCP (ils n'exposent pas non plus le logo).
