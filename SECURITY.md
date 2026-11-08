# Politique de sécurité

## Signaler une faille

**N'ouvre pas d'issue publique.** Écris à :

**baurice@pixelers.fr**

Tu peux aussi passer par le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**.

Indique :

- la version (commit ou tag) et le mode d'installation (Docker, manuel) ;
- la description de la faille et son impact ;
- les étapes pour la reproduire (preuve de concept minimale) ;
- si tu le souhaites, ton nom pour les remerciements.

Ne teste que sur ta propre instance. N'accède pas aux données des autres, ne dégrade pas un service, n'utilise pas d'ingénierie sociale.

## Ce qui se passe ensuite

- Accusé de réception sous 3 jours ouvrés.
- Première évaluation sous 10 jours ouvrés.
- Correctif publié dès que possible, puis annonce (avec ton accord pour les remerciements). Nous te tenons au courant à chaque étape.

## Versions suivies

Seule la dernière version de la branche `main` reçoit des correctifs de sécurité.

## Périmètre

Dans le périmètre : le code de ce dépôt (web, scanner, paquets, images Docker, docker-compose.yml).

Hors périmètre : les sites audités, les services tiers (fournisseurs d'IA, SMTP, n8n), une instance mal configurée en connaissance de cause (par exemple `WEBHOOKS_ALLOW_PRIVATE=1` exposé à des utilisateurs non fiables, voir docs/webhooks.md).

---

## Reporting a vulnerability (English)

Do not open a public issue. Email **baurice@pixelers.fr** (or use GitHub private vulnerability reporting, Security tab) with the affected version, a description, reproduction steps and the impact. Only test against your own instance. We acknowledge within 3 business days and keep you informed until a fix is released.
