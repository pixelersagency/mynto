#!/usr/bin/env node
// Crée le fichier d'environnement à partir de .env.example, avec des
// secrets frais, l'adresse publique et le compte admin.
//
//   pnpm run setup                 # écrit .env (docker compose)
//   pnpm run setup -- --dev        # écrit .env.local (pnpm dev, câblage local)
//   node scripts/init-env.mjs --file chemin/.env --force
//
// Sans Node sur la machine :
//   docker run --rm -it -v "$PWD:/app" -w /app node:22-alpine node scripts/init-env.mjs
//
// Non interactif (CI, scripts) : MYNTO_ADMIN_EMAIL, MYNTO_ADMIN_PASSWORD et
// MYNTO_PUBLIC_URL dans l'environnement, plus --yes.
//
// Aucune dépendance : Node 22 seul. N'écrase jamais un fichier existant sans
// --force. Le fichier est créé en 0600. Aucun secret n'est affiché.
import { randomBytes, scrypt } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { stdin, stderr } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dev = flag('--dev');
const force = flag('--force');
const yes = flag('--yes');
const target = path.resolve(ROOT, option('--file') ?? (dev ? '.env.local' : '.env'));

// Mêmes paramètres que apps/web/lib/auth/password.ts et hash-password.mjs.
const N = 2 ** 15;
const R = 8;
const P = 1;
function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      32,
      { N, r: R, p: P, maxmem: 256 * N * R + 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else
          resolve(
            ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join(':'),
          );
      },
    );
  });
}

const hex = (bytes) => randomBytes(bytes).toString('hex');

function readHidden(prompt) {
  return new Promise((resolve) => {
    stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stderr.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stderr.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function ask(rl, question, fallback) {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''} : `)).trim();
  return answer === '' ? (fallback ?? '') : answer;
}

/** Sets KEY=value, uncommenting `# KEY=` when needed; appends when absent. */
function setVar(text, key, value) {
  const line = `${key}=${value}`;
  const active = new RegExp(`^${key}=.*$`, 'm');
  if (active.test(text)) return text.replace(active, () => line);
  const commented = new RegExp(`^# ?${key}=.*$`, 'm');
  if (commented.test(text)) return text.replace(commented, () => line);
  return `${text.trimEnd()}\n${line}\n`;
}

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if ((await exists(target)) && !force) {
    stderr.write(
      `${path.relative(ROOT, target)} existe déjà. Rien n'a été modifié (--force pour le remplacer).\n`,
    );
    process.exit(1);
  }

  const interactive = stdin.isTTY && !yes;
  let email = process.env.MYNTO_ADMIN_EMAIL ?? '';
  let password = process.env.MYNTO_ADMIN_PASSWORD ?? '';
  let publicUrl = process.env.MYNTO_PUBLIC_URL ?? '';

  if (interactive) {
    const rl = createInterface({ input: stdin, output: stderr });
    stderr.write('Configuration de mynto. Entrée garde la valeur proposée.\n\n');
    publicUrl = await ask(
      rl,
      'Adresse publique (https://audit.ton-agence.fr)',
      publicUrl || 'http://localhost:3000',
    );
    email = await ask(rl, 'Email admin', email || undefined);
    rl.close();
    if (password === '') {
      password = await readHidden('Mot de passe admin (12 caractères minimum) : ');
      const again = await readHidden('Confirme : ');
      if (password !== again) {
        stderr.write('Les deux saisies ne correspondent pas.\n');
        process.exit(1);
      }
    }
  }

  publicUrl = (publicUrl || 'http://localhost:3000').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(publicUrl)) {
    stderr.write('Adresse publique invalide (attendu : https://domaine).\n');
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    stderr.write('Email admin invalide ou manquant (MYNTO_ADMIN_EMAIL en non interactif).\n');
    process.exit(1);
  }
  if (password.length < 12) {
    stderr.write(
      'Mot de passe admin : 12 caractères minimum (MYNTO_ADMIN_PASSWORD en non interactif).\n',
    );
    process.exit(1);
  }

  let text = await readFile(path.join(ROOT, '.env.example'), 'utf8');
  text = text.replace(
    /^# mynto : configuration de l'installation$/m,
    `# mynto : configuration générée le ${new Date().toISOString().slice(0, 10)} par scripts/init-env.mjs`,
  );
  const values = {
    PUBLIC_URL: publicUrl,
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD_HASH: await hashPassword(password),
    SESSION_SECRET: hex(32),
    SCANNER_INTERNAL_TOKEN: hex(32),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AUDIT_VIEWS_IP_HASH_SECRET: hex(32),
    ADMIN_TOKEN: hex(32),
    POSTGRES_PASSWORD: hex(24),
  };
  if (dev) {
    // pnpm dev : services sur la machine (ou Postgres/Redis de
    // docker-compose.override.example.yml).
    Object.assign(values, {
      DATABASE_URL: `postgres://mynto:${values.POSTGRES_PASSWORD}@127.0.0.1:5432/mynto`,
      REDIS_URL: 'redis://127.0.0.1:6379',
      MEDIA_DIR: './.local/media',
      SCANNER_API_URL: 'http://localhost:4000',
      WEB_BASE_URL: 'http://localhost:3000',
    });
  }
  for (const [k, v] of Object.entries(values)) text = setVar(text, k, v);

  await writeFile(target, text, { mode: 0o600 });
  await chmod(target, 0o600);
  stderr.write(
    [
      '',
      `${path.relative(ROOT, target)} créé (droits 0600). Secrets générés : SESSION_SECRET,`,
      'SCANNER_INTERNAL_TOKEN, APP_ENCRYPTION_KEY, AUDIT_VIEWS_IP_HASH_SECRET, ADMIN_TOKEN,',
      'POSTGRES_PASSWORD. Garde une copie de APP_ENCRYPTION_KEY en lieu sûr.',
      '',
      dev ? 'Suite : pnpm dev' : 'Suite : docker compose up -d',
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
