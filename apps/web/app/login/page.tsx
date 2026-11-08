import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from './LoginForm';

import { AgencyMark } from '@/components/agency-mark';
import { adminConfigStatus, getAdminSession } from '@/lib/auth/admin';
import { getBranding } from '@/lib/branding';
import { sanitizeNextPath } from '@/lib/safe-redirect';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connexion',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const raw = (await searchParams).next;
  const next = sanitizeNextPath(Array.isArray(raw) ? raw[0] : raw);
  if ((await getAdminSession()) !== null) redirect(next ?? '/dashboard');
  const status = adminConfigStatus();
  const brand = await getBranding();

  return (
    <div className="dash flex min-h-screen flex-col">
      <main id="main" className="dash-paper flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[340px]">
          <div className="mb-10 flex items-center gap-2.5">
            <AgencyMark name={brand.name} logoUrl={brand.logoUrl} size={24} />
            <span className="text-[14px] font-medium">{brand.name}</span>
          </div>
          <div>
            <h1 className="dash-display">Connexion</h1>
            <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
              Accède au tableau de bord des audits.
            </p>
            <div className="mt-5">
              {status.ok ? (
                <LoginForm next={next} />
              ) : (
                <div role="status" className="dash-note dash-note--warning">
                  <p className="font-medium">Connexion pas encore configurée</p>
                  <p className="mt-1">
                    Ajoute ces variables d’environnement puis redémarre l’application :{' '}
                    {status.missing.map((m, i) => (
                      <span key={m}>
                        {i > 0 ? ', ' : ''}
                        <code className="font-mono text-[12px]">{m}</code>
                      </span>
                    ))}
                    .
                  </p>
                  <p className="mt-1 text-[var(--fg-muted)]">
                    Le hash du mot de passe se génère avec{' '}
                    <code className="font-mono text-[12px]">pnpm admin:hash-password</code>.
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="mt-6 text-[12px] text-[var(--fg-muted)]">
            Session gardée 7 jours sur cet appareil.
          </p>
        </div>
      </main>
    </div>
  );
}
