#!/usr/bin/env node
// Prints an ADMIN_PASSWORD_HASH for the dashboard login.
//   pnpm admin:hash-password
// Prompts twice without echo (or reads one line from stdin when piped) and
// prints `scrypt:N:r:p:salt:key` (no `$`, so no escaping in .env / compose files). Same parameters as lib/auth/password.ts.
import { randomBytes, scrypt } from 'node:crypto';
import { stdin, stdout, stderr } from 'node:process';

const N = 2 ** 15;
const r = 8;
const p = 1;
const KEY_LEN = 32;

function hash(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LEN,
      { N, r, p, maxmem: 256 * N * r + 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else
          resolve(
            ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join(':'),
          );
      },
    );
  });
}

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

async function readPiped() {
  let data = '';
  for await (const chunk of stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

async function main() {
  let password;
  if (stdin.isTTY) {
    password = await readHidden('Mot de passe admin : ');
    const again = await readHidden('Confirme : ');
    if (password !== again) {
      stderr.write('Les deux saisies ne correspondent pas.\n');
      process.exit(1);
    }
  } else {
    password = await readPiped();
  }
  if (password.length < 12) {
    stderr.write('12 caractères minimum.\n');
    process.exit(1);
  }
  stdout.write(`${await hash(password)}\n`);
  stderr.write('Copie cette valeur dans ADMIN_PASSWORD_HASH.\n');
}

main().catch((err) => {
  stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
