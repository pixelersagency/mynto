# Liens de suivi et API Radar

> **Intégration optionnelle.** Radar est un outil de prospection externe. L'« API Radar » est en fait une API générique : n'importe quel outil (CRM, script, n8n) peut demander des audits et récupérer les liens de suivi avec le même contrat. Sans `RADAR_API_KEY`, les routes `/api/radar/*` répondent 503 et rien d'autre ne change. Pour la plupart des usages, l'[API REST v1](mcp.md) et les [webhooks](webhooks.md) suffisent.

Chaque audit lancé depuis le tableau de bord crée un **lien de suivi** `/r/<token>`. L'API Radar (prospection B2B) crée les mêmes liens par programme. Les deux partagent la table `radar_audits` (colonne `origin` : `dashboard` ou `radar`).

## Ce qui est mesuré (et ce qui ne l'est pas)

Le lien répond à une seule question : « a-t-il été ouvert ? ». C'est le minimum compatible avec l'article 82 de la loi Informatique et Libertés (pas de lecture ni d'écriture dans le terminal du visiteur sans nécessité).

- La page `/r/<token>` envoie **un seul** signal (`POST /api/radar/view`, corps `{ "token": "..." }`) après environ 5 secondes d'onglet visible. Rien n'est envoyé si l'onglet reste en arrière-plan, ni avec `?preview=1`, ni quand l'admin connecté ouvre son propre lien.
- Aucun cookie, aucun `sessionStorage` / `localStorage`, aucun identifiant de session, pas de temps de lecture, pas de sections lues.
- Côté serveur : on stocke la date d'ouverture et une famille de navigateur grossière (« Chrome, mobile », 200 caractères max). L'IP n'est jamais stockée en clair : seule une empreinte HMAC (`AUDIT_VIEWS_IP_HASH_SECRET`, ou un secret aléatoire par processus) sert à dédoublonner les ouvertures d'un même visiteur sur 30 minutes. Pas de pays.
- La page affiche une mention visible (« … sait si tu as ouvert ce rapport, rien de plus ») et une section « Confidentialité » en pied de page.
- Les robots, scanners de messagerie et clients sans navigateur sont filtrés (`apps/scanner/src/lib/radar/ua-filter.ts`).

## Rapports publics `/audit/full/<slug>`

Les lectures de la page rapport directe suivent la même politique depuis la migration `0006_audit_views_minimal` : comptées côté serveur (pour inclure les robots d’IA qui n’exécutent pas JavaScript), sans pays, avec une famille de navigateur au lieu du User-Agent brut, et l’empreinte HMAC de l’IP seulement pour le dédoublonnage sur 30 minutes. Les visites de l’admin (session ouverte ou `?preview=1`, utilisé par les liens du tableau de bord) ne comptent pas. La migration a converti les anciens User-Agent en familles et supprimé la colonne `country`.

## API Radar (inchangée)

Toutes les routes sont relayées par le web vers le scanner, qui vérifie `Authorization: Bearer <RADAR_API_KEY>` (503 si la clé n'est pas configurée).

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/radar/audits` | crée (ou réutilise sur 30 jours) un audit pour `{ url, external_ref }` et renvoie `tracking_url` |
| GET | `/api/radar/audits/:audit_id` | statut, score /100, axes, constats |
| POST | `/api/radar/audits/:audit_id/interpret` | déclenche la synthèse IA différée |
| POST | `/api/radar/audits/:audit_id/refresh` | relance le scan, même lien |

Les `tracking_url` utilisent `PUBLIC_URL` (sinon `WEB_BASE_URL`).

## Webhook `audit_viewed`

Ce webhook passe par les [webhooks sortants](webhooks.md#radar) : au démarrage, `RADAR_WEBHOOK_URL` et `RADAR_WEBHOOK_SECRET` créent un webhook « Géré par le .env », abonné à `link.opened`, avec l’option « Format Radar historique ». Le contrat ci-dessous ne change pas ; seule la politique d’envoi est celle des webhooks (6 tentatives sur environ 8 h 30, un `4xx` reste définitif) et chaque livraison apparaît dans Réglages > Webhooks.

Quand `RADAR_WEBHOOK_URL` et `RADAR_WEBHOOK_SECRET` sont définis, chaque ouverture comptée déclenche :

```json
{
  "tracking_token": "…",
  "event": "audit_viewed",
  "occurred_at": "2026-11-06T10:00:00.000Z",
  "duration_s": 0,
  "sections_viewed": []
}
```

En-têtes `X-Mynto-Timestamp` et `X-Mynto-Signature` (`sha256=` + HMAC-SHA256 de `${timestamp}.${body}`), inchangés.

**Champs dépréciés** : `duration_s` vaut toujours `0` et `sections_viewed` toujours `[]` depuis la migration `0002_dashboard`. Ils restent dans le contrat pour ne pas casser les intégrations existantes ; ne t'appuie plus dessus. Les colonnes correspondantes de `radar_audit_views` (`duration_s`, `sections_viewed`, `session_hash`) sont conservées pour l'historique mais ne sont plus écrites.

Le beacon accepte encore les anciens champs (`session_id`, `duration_s`, `sections_viewed`, `final`) envoyés par des pages mises en cache avant la mise à jour : ils sont ignorés.
