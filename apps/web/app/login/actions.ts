'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { adminConfigStatus, startSession, verifyAdminCredentials } from '@/lib/auth/admin';
import { loginThrottle } from '@/lib/auth/throttle';
import { trustedClientIp } from '@/lib/client-ip';
import { logger } from '@/lib/logger';
import { sanitizeNextPath } from '@/lib/safe-redirect';

export interface LoginState {
  error: string | null;
  email: string;
}

const LoginSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(1024),
  next: z.string().max(512).optional(),
});

const GENERIC_ERROR = 'Email ou mot de passe incorrect.';

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: form.get('email') ?? '',
    password: form.get('password') ?? '',
    next: form.get('next') ?? undefined,
  });
  const email = parsed.success ? parsed.data.email : '';
  if (!parsed.success || parsed.data.email.length === 0 || parsed.data.password.length === 0) {
    return { error: 'Indique ton email et ton mot de passe.', email };
  }
  if (!adminConfigStatus().ok) {
    return { error: 'La connexion n’est pas configurée sur ce serveur.', email };
  }

  const ip = trustedClientIp(await headers()) ?? 'unknown';
  const wait = loginThrottle.check(ip);
  if (wait !== null) {
    const minutes = Math.ceil(wait / 60);
    return {
      error: `Trop d’essais. Réessaye dans ${String(minutes)} minute${minutes > 1 ? 's' : ''}.`,
      email,
    };
  }

  const ok = await verifyAdminCredentials(parsed.data.email, parsed.data.password);
  if (!ok) {
    loginThrottle.recordFailure(ip);
    logger.warn('admin_login_failed');
    return { error: GENERIC_ERROR, email };
  }
  loginThrottle.reset(ip);
  await startSession();
  logger.info('admin_login_ok');
  const next = sanitizeNextPath(parsed.data.next);
  redirect(next !== null && next !== '/login' ? next : '/dashboard');
}
