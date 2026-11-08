import { type NextRequest, NextResponse } from 'next/server';

import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLUG_PATTERN = /^[A-Za-z0-9_-]{10,20}$/;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: NextRequest, ctx: Params): Promise<Response> {
  const { slug } = await ctx.params;
  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  }

  const env = getServerEnv();
  const url = `${env.SCANNER_API_URL.replace(/\/$/, '')}/api/audits/full/${slug}/pdf`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 60_000);

  try {
    const upstream = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!upstream.ok) {
      const body = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(body, { status: upstream.status });
    }
    const buffer = await upstream.arrayBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="audit-mynto-${slug}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      logger.warn({ slug }, 'full_audit_pdf_proxy_timeout');
      return NextResponse.json({ error: 'upstream_timeout' }, { status: 504 });
    }
    logger.error({ err: (err as Error).message, slug }, 'full_audit_pdf_proxy_error');
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
