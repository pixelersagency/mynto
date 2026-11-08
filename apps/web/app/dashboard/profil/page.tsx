import type { Metadata } from 'next';

import { Topbar } from '../_components/Topbar';
import { logoutAction } from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import { adminConfigStatus, requireAdmin } from '@/lib/auth/admin';

export const metadata: Metadata = { title: 'Profil' };

export default async function ProfilePage(): Promise<React.ReactElement> {
  const session = await requireAdmin();
  const cfg = adminConfigStatus();
  const expires = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(new Date(session.exp * 1000));
  return (
    <>
      <Topbar crumbs={[{ label: 'Profil' }]} />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-xl space-y-6">
          <h1 className="dash-display">Profil</h1>
          <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)] text-[13px]">
            <div className="flex gap-4 py-3">
              <dt className="w-40 text-[var(--fg-muted)]">Email</dt>
              <dd className="font-medium">{session.email}</dd>
            </div>
            <div className="flex gap-4 py-3">
              <dt className="w-40 text-[var(--fg-muted)]">Rôle</dt>
              <dd>Admin (un seul compte par installation)</dd>
            </div>
            <div className="flex gap-4 py-3">
              <dt className="w-40 text-[var(--fg-muted)]">Session valable jusqu’au</dt>
              <dd>{expires}</dd>
            </div>
          </dl>
          <div className="dash-group text-[13px] leading-relaxed">
            <h2 className="dash-heading">Changer le mot de passe</h2>
            <p className="mt-1 text-[var(--fg-muted)]">
              Lance <code className="font-mono">pnpm admin:hash-password</code>, colle le résultat
              dans <code className="font-mono">ADMIN_PASSWORD_HASH</code> puis redémarre. Pour
              fermer toutes les sessions ouvertes, change aussi{' '}
              <code className="font-mono">SESSION_SECRET</code>.
            </p>
            {cfg.ok && cfg.mode === 'plain' ? (
              <p className="mt-2 font-medium text-[var(--warning)]">
                Ton mot de passe est stocké en clair (ADMIN_PASSWORD). Passe au hash dès que
                possible.
              </p>
            ) : null}
          </div>
          <form action={logoutAction}>
            <DashButton type="submit">Se déconnecter</DashButton>
          </form>
        </div>
      </main>
    </>
  );
}
