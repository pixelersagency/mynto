import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { closeSql, getSql } from '@mynto/db';
import { runMigrations } from '@mynto/db/migrate';
import Fastify from 'fastify';

import { config } from './config.js';
import { rateLimitKey } from './lib/client-ip.js';
import { createShutdownHandler } from './lib/shutdown.js';
import { logger } from './logger.js';
import { syncRadarWebhookEndpoint } from './queue/webhook-processor.js';
import { startWorker, stopWorker } from './queue/worker.js';
import { redis } from './redis.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuditsFullRoutes } from './routes/audits-full.js';
import { logOutboundStatus, registerHealthRoute } from './routes/health.js';
import { registerRadarRoutes } from './routes/radar.js';

/** The HTTP server, once created (closed first on shutdown). */
let app: { close: () => Promise<unknown> } | null = null;

// Armed before anything else so a SIGTERM during the boot (migrations
// waiting for Postgres, Redis down) also ends the process within the
// deadline. See lib/shutdown.ts.
const shutdown = createShutdownHandler({
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  logger,
  steps: [
    { name: 'http', run: async () => app?.close() },
    { name: 'workers', run: stopWorker },
    { name: 'postgres', run: () => closeSql() },
    {
      name: 'redis',
      // quit() waits for a reply that never comes when Redis is down.
      run: async () => {
        if (redis.status === 'ready') await redis.quit();
        else redis.disconnect();
      },
    },
  ],
});
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function main(): Promise<void> {
  if (config.SCANNER_DNS_RESOLVER === 'doh') {
    logger.info('dns_resolver_doh: the SSRF guard resolves names over DNS-over-HTTPS');
  }
  if (config.DB_MIGRATE_ON_START) {
    const result = await runMigrations(getSql());
    logger.info(
      { applied: result.applied, upToDate: result.skipped.length },
      'db_migrations_checked',
    );
  }

  // RADAR_WEBHOOK_URL / RADAR_WEBHOOK_SECRET -> webhook endpoint with the
  // historical "audit_viewed" format. Never blocks the boot.
  await syncRadarWebhookEndpoint().catch((err: unknown) => {
    logger.error(
      { err: err instanceof Error ? err.message : 'unknown' },
      'radar_webhook_sync_failed',
    );
  });

  const server = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    disableRequestLogging: false,
  });
  app = server;

  await server.register(cors, {
    origin: config.ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  });

  await server.register(rateLimit, {
    global: false,
    redis,
    // Sans ça, la clé par défaut est `req.ip`, soit le premier hop de
    // X-Forwarded-For, que l'appelant contrôle entièrement.
    keyGenerator: rateLimitKey,
  });

  server.setErrorHandler((err, req, reply) => {
    const e = err as Error;
    req.log.error({ err: e.message, stack: e.stack }, 'unhandled request error');
    if (config.NODE_ENV === 'production') {
      return reply.code(500).send({ error: 'internal' });
    }
    return reply.code(500).send({ error: 'internal', message: e.message });
  });

  registerHealthRoute(server);
  registerAuditsFullRoutes(server);
  registerAdminRoutes(server);
  registerRadarRoutes(server);

  startWorker();

  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'scanner ready');

  // Every audit is HTTP probes and nothing else. If egress is broken the
  // audits still "succeed" with a score of 0 on every check, so say it
  // out loud at boot rather than letting the reports lie. Not awaited:
  // the server is already serving.
  void logOutboundStatus().catch((err: unknown) => {
    // We are past server.listen() here, so an unhandled rejection would kill
    // a server that is already serving.
    logger.error({ err: (err as Error).message }, 'outbound_probe_boot_failed');
  });
}

main().catch((err: unknown) => {
  const e = err as Error;
  logger.fatal({ err: e.message }, 'fatal boot error');
  process.exit(1);
});
