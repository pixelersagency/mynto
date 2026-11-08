# Lighthouse : lancement Docker et couverture des scores

Le 6 novembre 2026, le scanner de production tournait sous UID 10001, Node 24.14.1, avec Chromium 147.0.7727.15 fourni par Playwright. `--version` fonctionnait, mais `chrome-launcher` échouait avant l’ouverture du port DevTools avec `ECONNREFUSED 127.0.0.1:<port>`. Son journal Chromium indiquait `chrome_crashpad_handler: --database is required`.

L’utilisateur `mynto` était créé avec `useradd -M`. `HOME=/home/mynto` pointait sur un dossier absent. Dans le même conteneur, même UID et même binaire :

- Les flags `--disable-breakpad --disable-crash-reporter` ne corrigeaient pas le lancement.
- Des dossiers XDG temporaires accessibles en écriture permettaient l’ouverture de DevTools.
- Avec ces seuls dossiers XDG temporaires, Lighthouse terminait une mesure sur `https://example.com` avec `runtimeError: null` et `performance: 1`.

Le Dockerfile crée désormais le home et ses dossiers `.config` et `.cache`, appartenant à `mynto`, et définit les chemins HOME/XDG correspondants. Aucune modification de l’instance en cours ni déploiement n’a été effectué pour ce correctif. L’image reconstruite reste à vérifier. Le crash de trace observé sur macOS est distinct et cette correction ne prétend pas le résoudre.

## Vérification de l’image reconstruite

Depuis la racine du dépôt, sur une machine avec Docker :

```sh
docker compose build scanner
docker compose run --rm --no-deps scanner timeout 65s node --input-type=module -e '
import { accessSync, constants, statSync } from "node:fs";
import assert from "node:assert/strict";
import * as launcher from "chrome-launcher";
import { chromium } from "playwright";
import lighthouse from "lighthouse";
assert.equal(process.getuid(), 10001);
for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) {
  assert.ok(process.env[key]);
  assert.ok(statSync(process.env[key]).isDirectory());
  accessSync(process.env[key], constants.W_OK | constants.X_OK);
}
let chrome;
try {
  chrome = await launcher.launch({ chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
    maxConnectionRetries: 3 });
  const version = await fetch(`http://127.0.0.1:${chrome.port}/json/version`);
  assert.equal(version.status, 200);
  const result = await lighthouse("https://example.com", { port: chrome.port,
    onlyCategories: ["performance"], logLevel: "silent", maxWaitForLoad: 25000 });
  assert.ok(result?.lhr);
  assert.ok(!result.lhr.runtimeError);
  assert.equal(typeof result.lhr.categories.performance.score, "number");
  console.log("Chromium et Lighthouse : OK");
} finally { if (chrome) await chrome.kill(); }
'
```

Ce test vérifie un lancement et une vraie mesure. Il ne prouve pas qu’un site quelconque sera mesurable. Une panne réseau, une interstitielle, un crash ou une mesure absente restent des résultats indisponibles.

## Dégradation explicite

Le délai du collecteur couvre le lancement et toute l’analyse : 60 secondes, puis fermeture synchrone du groupe de processus Chromium par `chrome-launcher`. Un lancement résolu après expiration est aussi fermé. Un `runtimeError` Lighthouse est traité comme un échec, même lorsque l’appel n’a pas levé d’exception.

Les échecs Lighthouse, axe et Vision sont conservés sous forme de codes stables dans `facts.errors`, sans réponse brute, URL ou message d’exception potentiellement sensible. Exemples : `lighthouse_runtime_CHROME_INTERSTITIAL_ERROR`, `lighthouse_timeout`, `axe_unavailable`, `vision_capture_unavailable`, `vision_response_unavailable`. Un collecteur désactivé ou non configuré est distingué d’un collecteur tenté.

L’axe performance est suspendu sans score Lighthouse valide ; l’accessibilité sans axe ; UI, UX et conversion sans Vision. Les contrôles déterministes et leurs constats continuent de figurer dans le rapport. Les observations `advisory` ne pénalisent pas le score et ne reçoivent pas de chiffrage. Les mesures rendues UI/UX sont collectées indépendamment d’une clé Vision et ne certifient pas, à elles seules, l’ensemble d’un axe.

Un axe suspendu est absent de `axis_scores`, apparaît « Non évalué » et est exclu du dénominateur global et de la couverture. Aucun axe évalué donne un score et une bande globaux `null`. Les affichages de synthèse utilisent `/100`. Les audits historiques ne sont pas réécrits automatiquement. Les contrôles SSRF existants sont conservés.
