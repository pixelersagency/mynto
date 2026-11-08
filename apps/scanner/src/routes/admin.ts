import type { FastifyInstance } from 'fastify';

import { verifyAdminToken } from '../lib/admin-auth.js';
import { logger } from '../logger.js';
import { getFullAuditQueueCounts } from '../queue/full-audit-queue.js';

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/api/admin/queue-stats', async (req, reply) => {
    const token = req.headers['x-admin-token'];
    const tokenStr = Array.isArray(token) ? token[0] : token;

    if (!verifyAdminToken(tokenStr)) {
      logger.warn({ ip: req.ip }, 'admin auth failed');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const counts = await getFullAuditQueueCounts();
    return reply.code(200).send(counts);
  });
}
