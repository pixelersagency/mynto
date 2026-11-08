# Webhooks sortants

Un webhook prévient tes outils (n8n, Make, Zapier, CRM, Slack via un relais…) quand il se passe quelque chose sur un audit : scan terminé, rapport ouvert par le prospect, email envoyé. Chaque événement part en `POST` JSON signé vers l’adresse que tu as enregistrée.

Gestion : **Réglages > Webhooks** dans le tableau de bord, l’API REST (`/api/v1/webhooks`) ou les outils MCP (`list_webhooks`, `create_webhook`, `test_webhook`).

## Événements

| Événement | Quand |
|---|---|
| `audit.created` | audit lancé (tableau de bord, API, MCP, Radar). Pas sur un rafraîchissement ni sur un audit Radar réutilisé depuis le cache. |
| `audit.completed` | premier scan terminé avec succès |
| `audit.failed` | scan en échec (y compris un scan rafraîchi) |
| `audit.refreshed` | scan rafraîchi terminé, même lien. Remplace `audit.completed` pour un rafraîchissement : abonne-toi aux deux pour suivre tous les scores. |
| `audit.deleted` | audit supprimé (tableau de bord, API). La purge des audits expirés n’envoie rien. |
| `link.first_opened` | première ouverture d’un lien de suivi `/r/` |
| `link.opened` | chaque ouverture comptée, dédoublonnée sur 30 minutes par visiteur (la première incluse) |
| `email.sent` | rapport envoyé par SMTP depuis la fiche audit |
| `email.failed` | envoi SMTP en échec |
| `ping` | test lancé depuis les réglages, l’API ou MCP. Jamais abonné : il part vers un seul webhook, même désactivé. |

Une première ouverture produit donc deux événements : `link.first_opened` puis `link.opened`. L’ordre d’arrivée n’est pas garanti : trie sur `created_at` si besoin.

## Requête

```
POST <ton adresse>
Content-Type: application/json
User-Agent: Mynto-Webhook/1.0
X-Mynto-Event: link.first_opened
X-Mynto-Delivery: 3f0c2b1e-6a59-4d8e-9a43-1b2c3d4e5f60
X-Mynto-Signature: t=1793959200,v1=5d2a…64 caractères hex…
```

- `X-Mynto-Event` : le type d’événement.
- `X-Mynto-Delivery` : identifiant de la livraison. Un « Renvoyer » crée une nouvelle livraison, donc un nouvel identifiant, avec le même corps.
- `X-Mynto-Signature` : voir [Vérifier la signature](#vérifier-la-signature).

Réponds `2xx` en moins de 10 secondes. Fais le travail lourd en asynchrone si besoin.

## Charge utile

Enveloppe commune :

```json
{
  "id": "evt_8c1d0e9b2f4a6c3e5d7b9a1f",
  "type": "link.first_opened",
  "created_at": "2026-11-06T10:00:00.000Z",
  "api_version": "2026-11-01",
  "data": { }
}
```

| Champ | Type | Rôle |
|---|---|---|
| `id` | string `evt_` + 24 hex | identifiant de l’événement, **stable** entre les tentatives et les renvois : dédoublonne dessus |
| `type` | string | un des événements ci-dessus |
| `created_at` | date ISO 8601 | moment de l’événement (pour `link.*`, l’heure de l’ouverture) |
| `api_version` | string | version du contrat, `2026-11-01` |
| `data` | objet | dépend du type (ci-dessous) |

### Objets communs

`data.audit` :

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | identifiant de l’audit (le même que dans l’API) |
| `slug` | string | identifiant du rapport public |
| `url` | string | site audité |
| `label` | string ou null | libellé saisi par l’agence |
| `score` | entier 0-100 ou null | score global sur les axes évalués, `null` tant que l’audit n’est pas terminé |
| `ai_score` | entier 0-100 | score Préparation IA, **absent** quand le module n’a pas tourné ou que l’audit n’est pas terminé |
| `status` | string | `queued`, `running`, `completed`, `failed` |
| `source` | string | `dashboard`, `api`, `mcp`, `radar`, `web` |
| `previous_id` | uuid | **seulement** sur `audit.refreshed` (et un échec de rafraîchissement) : le scan remplacé |

`data.link` (le lien de suivi, `null` s’il n’existe plus) :

| Champ | Type | Rôle |
|---|---|---|
| `id` | uuid | identifiant du lien |
| `url` | string | `https://…/r/<token>`, le lien envoyé au prospect |
| `external_ref` | string ou null | référence Radar (`null` pour un lien du tableau de bord) |
| `views_count` | entier | ouvertures comptées jusque-là |
| `first_opened_at` | date ou null | première ouverture |

`data.report_url` : lien du rapport. Pour un audit Radar, c’est le lien de suivi ; sinon le rapport direct `/audit/full/<slug>`. `null` sur `audit.deleted`.

### Schéma JSON par événement

`audit.created`, `audit.completed`, `audit.failed`, `audit.refreshed`, `audit.deleted`, `link.first_opened`, `link.opened` :

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "type", "created_at", "api_version", "data"],
  "properties": {
    "id": { "type": "string", "pattern": "^evt_[0-9a-f]{24}$" },
    "type": { "enum": ["audit.created", "audit.completed", "audit.failed", "audit.refreshed", "audit.deleted", "link.first_opened", "link.opened"] },
    "created_at": { "type": "string", "format": "date-time" },
    "api_version": { "const": "2026-11-01" },
    "data": {
      "type": "object",
      "required": ["audit", "link", "report_url"],
      "properties": {
        "audit": {
          "type": "object",
          "required": ["id", "slug", "url", "label", "score", "status", "source"],
          "properties": {
            "id": { "type": "string", "format": "uuid" },
            "slug": { "type": "string" },
            "url": { "type": "string" },
            "label": { "type": ["string", "null"] },
            "score": { "type": ["integer", "null"], "minimum": 0, "maximum": 100 },
            "ai_score": { "type": "integer", "minimum": 0, "maximum": 100 },
            "status": { "enum": ["queued", "running", "completed", "failed"] },
            "source": { "enum": ["dashboard", "api", "mcp", "radar", "web"] },
            "previous_id": { "type": "string", "format": "uuid" }
          }
        },
        "link": {
          "type": ["object", "null"],
          "required": ["id", "url", "external_ref", "views_count", "first_opened_at"],
          "properties": {
            "id": { "type": "string", "format": "uuid" },
            "url": { "type": "string" },
            "external_ref": { "type": ["string", "null"] },
            "views_count": { "type": "integer", "minimum": 0 },
            "first_opened_at": { "type": ["string", "null"], "format": "date-time" }
          }
        },
        "report_url": { "type": ["string", "null"] }
      }
    }
  }
}
```

`email.sent` et `email.failed` : même schéma, plus `data.email` (obligatoire) :

```json
{
  "email": {
    "type": "object",
    "required": ["recipient", "subject", "status", "error_code"],
    "properties": {
      "recipient": { "type": "string", "description": "adresse saisie par l’agence" },
      "subject": { "type": "string" },
      "status": { "enum": ["sent", "failed"] },
      "error_code": { "type": ["string", "null"], "description": "auth, connection, rejected, timeout…" }
    }
  }
}
```

`ping` :

```json
{
  "type": "object",
  "required": ["id", "type", "created_at", "api_version", "data"],
  "properties": {
    "type": { "const": "ping" },
    "data": {
      "type": "object",
      "properties": {
        "message": { "type": "string" },
        "endpoint_id": { "type": "string", "format": "uuid" }
      }
    }
  }
}
```

### Exemples

`audit.completed` :

```json
{
  "id": "evt_1b3d5f7a9c2e4a6c8e0b2d4f",
  "type": "audit.completed",
  "created_at": "2026-11-06T09:57:12.410Z",
  "api_version": "2026-11-01",
  "data": {
    "audit": {
      "id": "0b7c6a52-3f1e-4c0b-9d7a-5e2f1c8b4a90",
      "slug": "q4Zr8sT1uVw2",
      "url": "https://boulangerie-martin.fr",
      "label": "Boulangerie Martin",
      "score": 64,
      "ai_score": 41,
      "status": "completed",
      "source": "dashboard"
    },
    "link": {
      "id": "c2a1e0f4-7b6d-4e3a-8f1c-2d9b5a6e7f80",
      "url": "https://audit.agence.fr/r/hX7…",
      "external_ref": null,
      "views_count": 0,
      "first_opened_at": null
    },
    "report_url": "https://audit.agence.fr/audit/full/q4Zr8sT1uVw2"
  }
}
```

`email.failed` :

```json
{
  "id": "evt_7e9a1c3e5b7d9f1a3c5e7a9b",
  "type": "email.failed",
  "created_at": "2026-11-06T10:03:40.002Z",
  "api_version": "2026-11-01",
  "data": {
    "audit": { "id": "0b7c6a52-…", "slug": "q4Zr8sT1uVw2", "url": "https://boulangerie-martin.fr", "label": "Boulangerie Martin", "score": 64, "status": "completed", "source": "dashboard" },
    "link": { "id": "c2a1e0f4-…", "url": "https://audit.agence.fr/r/hX7…", "external_ref": null, "views_count": 0, "first_opened_at": null },
    "report_url": "https://audit.agence.fr/audit/full/q4Zr8sT1uVw2",
    "email": { "recipient": "contact@boulangerie-martin.fr", "subject": "Audit de boulangerie-martin.fr : 64/100", "status": "failed", "error_code": "auth" }
  }
}
```

### Données personnelles

Aucune donnée du visiteur : ni IP, ni empreinte, ni navigateur, ni pays. Jamais l’email de contact de l’audit ni les données envoyées à l’IA. Seuls `email.sent` et `email.failed` portent une adresse : celle que l’agence a saisie elle-même pour envoyer le rapport.

Le lien de suivi (`data.link.url`) contient le jeton du rapport : traite-le comme un secret (pas de journalisation publique).

## Vérifier la signature

`X-Mynto-Signature: t=<horodatage>,v1=<signature>`

- `t` : secondes Unix au moment de l’envoi (recalculé à chaque tentative) ;
- `v1` : HMAC-SHA256 en hexadécimal de `<t>.<corps brut>` avec le secret du webhook (`whsec_…`).

Côté récepteur :

1. lis le corps **brut**, avant tout parsing JSON (un JSON re-sérialisé ne donne pas les mêmes octets) ;
2. recalcule `HMAC-SHA256(secret, t + "." + corps)` et compare en temps constant ;
3. refuse si `|maintenant - t| > 300` secondes (**tolérance de rejeu : 5 minutes**) ;
4. dédoublonne sur `id` (garde les identifiants vus depuis 24 heures au moins) : un même événement peut arriver plusieurs fois (nouvelle tentative après un délai dépassé, « Renvoyer »).

### Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const SECRET = process.env.MYNTO_WEBHOOK_SECRET; // whsec_…
const seen = new Set(); // remplace par Redis ou ta base en production

function verify(header, rawBody, toleranceS = 300) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceS) return false;
  const expected = createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}

const app = express();
app.post('/mynto', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body.toString('utf8');
  if (!verify(req.get('X-Mynto-Signature'), raw)) return res.sendStatus(401);
  const event = JSON.parse(raw);
  if (seen.has(event.id)) return res.sendStatus(200); // déjà traité
  seen.add(event.id);
  // … ton traitement (en asynchrone si c’est long)
  res.sendStatus(200);
});
app.listen(3001);
```

### Python

```python
import hashlib
import hmac
import json
import os
import time

from flask import Flask, abort, request

SECRET = os.environ["MYNTO_WEBHOOK_SECRET"].encode()  # whsec_…
seen: set[str] = set()  # remplace par Redis ou ta base en production
app = Flask(__name__)


def verify(header: str | None, raw: bytes, tolerance_s: int = 300) -> bool:
    try:
        parts = dict(p.split("=", 1) for p in (header or "").split(","))
        t = int(parts["t"])
        v1 = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance_s:
        return False
    expected = hmac.new(SECRET, f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


@app.post("/mynto")
def mynto():
    raw = request.get_data()  # octets bruts, avant json
    if not verify(request.headers.get("X-Mynto-Signature"), raw):
        abort(401)
    event = json.loads(raw)
    if event["id"] in seen:
        return "", 200
    seen.add(event["id"])
    # … ton traitement
    return "", 200
```

### n8n

1. Nœud **Webhook** : méthode `POST`, chemin `mynto`, « Respond » : *Immediately*. Dans *Options*, active **Raw Body** (le corps arrive en binaire, octets intacts).
2. Nœud **Code** (JavaScript, « Run Once for All Items »). `crypto` est un module intégré : sur un n8n auto-hébergé, autorise-le avec `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.

```js
const crypto = require('crypto');
const SECRET = 'whsec_…'; // ou $env.MYNTO_WEBHOOK_SECRET si tu l’exposes à n8n

const item = $input.first();
const raw = Buffer.from(item.binary.data.data, 'base64').toString('utf8');
const header = item.json.headers['x-mynto-signature'] ?? '';
const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
const t = Number(parts.t);
const expected = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
const fresh = Math.abs(Date.now() / 1000 - t) <= 300;
const valid =
  fresh &&
  typeof parts.v1 === 'string' &&
  parts.v1.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
if (!valid) throw new Error('Signature mynto invalide');

const event = JSON.parse(raw);
return [{ json: event }];
```

3. Nœud **IF** ou **Switch** sur `{{ $json.type }}` (`link.first_opened` pour relancer le prospect, `audit.completed` pour créer une tâche CRM…).
4. Pour dédoublonner, garde `{{ $json.id }}` dans une table (Data store, Postgres, Redis) et arrête le flux s’il y est déjà.

Astuce : un workflow n8n désactivé répond `404`. Mynto réessaie (voir ci-dessous), donc rien n’est perdu si tu le réactives dans les 9 heures environ.

## Fiabilité

- **Outbox** : l’événement est écrit en base dans la même transaction que le changement qui le cause (audit créé, scan terminé, ouverture comptée, email journalisé). Si la transaction échoue, aucun événement ; si le processus s’arrête juste après, l’événement est déjà en base et partira au redémarrage.
- **Distribution** : le scanner relève les nouveaux événements toutes les 3 secondes (file BullMQ `webhook-dispatch`), crée une livraison par webhook abonné avec le corps figé, puis envoie chaque tentative par la file `webhook-delivery`. Un balayage reprend toute livraison due dont la tâche aurait été perdue.
- **Délai** : 10 secondes par tentative. **Redirections refusées** : un `3xx` est un échec définitif, jamais suivi.
- **Tentatives** : 6 au total. Après un échec, la suivante part après 1 min, 5 min, 30 min, 2 h puis 6 h (environ 8 h 36 en tout). Réessayé : erreur réseau, délai dépassé, tout code non `2xx` sauf `410 Gone`. Définitif tout de suite : `410`, redirection, adresse refusée (SSRF), secret illisible.
- **Désactivation automatique** : après **20 échecs définitifs de suite** sur un webhook, il passe inactif. Une alerte apparaît dans l’accueil (« À faire ») et une pastille rouge sur l’onglet Réglages > Webhooks. Corrige la cible, envoie un ping, puis réactive-le : le compteur repart de zéro. Un succès remet aussi le compteur à zéro.
- **Journal** : 30 jours (purge quotidienne). Pour chaque livraison : date, événement, statut, code HTTP, durée, tentatives, corps envoyé, et pour chaque tentative les 2 premiers Ko de la réponse. Bouton **Renvoyer** : même corps, même `id`, nouvelle livraison.

## Secret

Généré à la création (`whsec_` + 32 octets aléatoires), affiché **une seule fois**. Il est stocké chiffré en AES-256-GCM avec `APP_ENCRYPTION_KEY` (pas haché : le scanner en a besoin pour signer), lié à l’identifiant du webhook. « Régénérer le secret » en crée un nouveau, affiché une fois, et l’ancien cesse de marcher immédiatement : mets à jour ton récepteur dans la foulée.

Sans `APP_ENCRYPTION_KEY` (même valeur dans le web et le scanner), la création est refusée ; si la clé change, les livraisons échouent avec « Secret illisible » : régénère le secret de chaque webhook.

## Adresses autorisées (SSRF)

Par défaut :

- **HTTPS obligatoire** ;
- l’adresse doit être **publique** : refus de `localhost`, des noms sans point ou en `.local` / `.internal`, des plages privées (10/8, 172.16/12, 192.168/16), boucle locale, link-local (dont 169.254.169.254, les métadonnées cloud), CGNAT 100.64/10, plages de test et multicast, IPv6 privées ;
- le contrôle est refait **à chaque tentative** sur toutes les adresses renvoyées par le DNS, et l’adresse validée est **épinglée** à la connexion (un DNS qui change de réponse entre le contrôle et l’envoi ne passe pas).

### `WEBHOOKS_ALLOW_PRIVATE=1`

À mettre dans le `.env` (web **et** scanner) pour viser un service du même réseau, par exemple un n8n auto-hébergé à côté de mynto (`http://n8n:5678/webhook/mynto`). Avec cette option, les adresses privées et `http` sont acceptées ; les identifiants dans l’URL restent refusés et l’adresse reste épinglée.

Risques, à connaître avant de l’activer :

- **Quiconque peut créer un webhook peut faire envoyer des requêtes POST vers ton réseau interne** : base de données avec API HTTP, panneau d’administration, Redis exposé en HTTP, métadonnées du cloud (`169.254.169.254`). Une clé API mynto ou un accès MCP suffit pour créer un webhook : protège-les.
- Le journal des livraisons affiche les 2 premiers Ko des réponses : un service interne pourrait y laisser fuiter des informations.
- En `http`, le corps (liens de suivi, adresse email des événements `email.*`) circule en clair sur le réseau.

Réserve-la à une instance où toi seul as les accès, sur un réseau que tu maîtrises. Préfère un réseau Docker dédié entre mynto et n8n plutôt que l’accès à tout le réseau de l’hôte : c’est ce que fait [docker-compose.n8n.yml](../docker-compose.n8n.yml) (`docker network create n8n`, puis `docker compose -f docker-compose.yml -f docker-compose.n8n.yml up -d`). Il active l’option pour le web et le scanner seulement dans ce cas, et les relie au seul réseau `n8n` en plus du leur.

Si le DNS de la machine est filtré (VPN, DNS d’entreprise), `SCANNER_DNS_RESOLVER=doh` fait résoudre les noms par DNS-over-HTTPS ; la même liste de blocage s’applique aux réponses.

## Radar

L’ancien webhook Radar (`audit_viewed`) devient un webhook comme les autres. Au démarrage, si `RADAR_WEBHOOK_URL` et `RADAR_WEBHOOK_SECRET` sont définis, le scanner crée (ou met à jour) un webhook :

- abonné à `link.opened`, avec l’option **« Format Radar historique »** cochée ;
- marqué « Géré par le .env » : son adresse vient de `RADAR_WEBHOOK_URL`, il est signé avec `RADAR_WEBHOOK_SECRET`, il ne peut pas être supprimé depuis le tableau de bord (retire les variables : il passe inactif) ;
- comme avant, son adresse n’est pas soumise au contrôle des adresses privées (elle vient du `.env`, pas du tableau de bord ni de l’API) ; elle reste en HTTPS et épinglée ;
- tant que l’option est cochée, chaque ouverture part **octet pour octet** comme avant :

```
X-Mynto-Timestamp: 1793959200
X-Mynto-Signature: sha256=<hex HMAC-SHA256 de "<timestamp>.<corps>">
Content-Type: application/json
User-Agent: Mynto-Webhook/1.0

{"tracking_token":"…","event":"audit_viewed","occurred_at":"2026-11-06T10:00:00.000Z","duration_s":0,"sections_viewed":[]}
```

Mêmes en-têtes (ni `X-Mynto-Event` ni `X-Mynto-Delivery`), mêmes clés dans le même ordre, `occurred_at` identique à l’heure enregistrée de l’ouverture (Radar dédoublonne sur `tracking_token` + `occurred_at`). Seule différence : la politique d’envoi est celle des webhooks (6 tentatives sur environ 8 h 30 au lieu de 3 en 15 s), et, comme avant, un `4xx` de Radar est définitif.

Tu peux abonner ce webhook à d’autres événements : ils partent au format standard, signés avec `RADAR_WEBHOOK_SECRET`. Décoche « Format Radar historique » seulement quand Radar lit le format standard.

La file BullMQ `radar-webhook` n’est plus alimentée ; le scanner la vide encore des tâches laissées par une version précédente.

## API et MCP

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/v1/webhooks` | liste (sans secret) |
| POST | `/api/v1/webhooks` | crée `{ url, events, description?, active? }`, répond `201` avec `secret` (une seule fois) |
| GET | `/api/v1/webhooks/{id}` | un webhook |
| PATCH | `/api/v1/webhooks/{id}` | `url`, `events`, `description`, `active`, `legacy_radar_format` |
| DELETE | `/api/v1/webhooks/{id}` | supprime le webhook et son journal |
| POST | `/api/v1/webhooks/{id}/test` | met un `ping` en file (`202`) |
| POST | `/api/v1/webhooks/{id}/rotate-secret` | nouveau secret, renvoyé une fois |
| GET | `/api/v1/webhooks/{id}/deliveries` | journal `?status=pending\|success\|failed&limit=&offset=` |
| GET | `/api/v1/webhooks/{id}/deliveries/{deliveryId}` | détail : corps envoyé, tentatives |
| POST | `/api/v1/webhooks/{id}/deliveries/{deliveryId}/resend` | renvoie (même corps, même `id`) |

Outils MCP : `list_webhooks`, `create_webhook` (le secret est dans la réponse, une seule fois), `test_webhook`.

```sh
curl -X POST "$MYNTO_URL/api/v1/webhooks" \
  -H "Authorization: Bearer $MYNTO_API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://n8n.agence.fr/webhook/mynto","events":["link.first_opened","audit.completed"],"description":"n8n relances"}'
```
