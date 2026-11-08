/**
 * Next.js instrumentation hook (runs once per server start). Everything
 * lives in instrumentation-node.ts: importing it only under the nodejs
 * runtime keeps Node-only modules (ioredis, node:crypto) out of the edge
 * bundle. See that file for the boot checks and the bounded shutdown.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
