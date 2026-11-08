/**
 * Node.js part of instrumentation.ts. Boot checks (Next.js instrumentation hook, runs once per server start):
 *   - environment validation, in French, variable names only. Invalid values
 *     stop the server; in production so do the variables the install cannot
 *     work without (database, admin account, session, scanner token);
 *   - loud warning when the admin password is configured in plain text;
 *   - graceful shutdown with a hard deadline: Next closes the HTTP server on
 *     SIGTERM, but a keep-alive connection can hold it open. After
 *     WEB_SHUTDOWN_TIMEOUT_MS (8 s by default) the process exits anyway, so
 *     `docker compose stop` never has to SIGKILL it.
 */
export async function registerNode(): Promise<void> {
  const env = process.env;
  const production = env.NODE_ENV === 'production';

  const { checkServerEnv } = await import('./lib/env');
  const check = checkServerEnv(env, production);
  if (check.errors.length > 0) {
    console.error(
      [
        '',
        '[mynto web] Configuration invalide, le serveur ne démarre pas :',
        ...check.errors,
        'Voir .env.example (chaque variable y est documentée).',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  if (check.warnings.length > 0) {
    console.warn(['[mynto web] Configuration incomplète :', ...check.warnings].join('\n'));
  }

  if (env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) {
    console.warn(
      [
        '',
        '################################################################',
        '#  ATTENTION : ADMIN_PASSWORD est défini en clair.             #',
        '#  Pratique pour un premier essai, pas pour la production.     #',
        '#  Génère un hash : pnpm admin:hash-password                   #',
        '#  puis remplace ADMIN_PASSWORD par ADMIN_PASSWORD_HASH.       #',
        '################################################################',
        '',
      ].join('\n'),
    );
  }

  const timeoutMs = Number(env.WEB_SHUTDOWN_TIMEOUT_MS ?? '8000');
  let stopping = false;
  const onSignal = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.warn(`[mynto web] ${signal} reçu, arrêt (${String(timeoutMs)} ms au plus)`);
    setTimeout(
      () => {
        console.error('[mynto web] arrêt forcé : délai dépassé');
        process.exit(1);
      },
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8_000,
    ).unref();
    void import('./lib/rate-limit-shared')
      .then((m) => m.closeSharedRateLimit())
      .catch(() => undefined);
  };
  // Next's own handlers (registered too) close the server and exit 0.
  process.once('SIGTERM', () => {
    onSignal('SIGTERM');
  });
  process.once('SIGINT', () => {
    onSignal('SIGINT');
  });
}
