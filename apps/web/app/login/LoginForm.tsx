'use client';

import { useActionState } from 'react';

import { loginAction, type LoginState } from './actions';

import { DashButton } from '@/components/ui/dash-button';

const INPUT =
  'h-9 w-full rounded-md border border-[var(--border-input)] bg-[var(--bg)] px-3 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus-visible:border-[var(--accent)]';

export function LoginForm({ next }: { next: string | null }): React.ReactElement {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {
    error: null,
    email: '',
  });
  return (
    <form action={action} className="space-y-4" noValidate>
      {next !== null ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[13px] font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          aria-invalid={state.error !== null}
          aria-describedby={state.error !== null ? 'login-error' : undefined}
          className={INPUT}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[13px] font-medium">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error !== null}
          aria-describedby={state.error !== null ? 'login-error' : undefined}
          className={INPUT}
        />
      </div>
      <div aria-live="polite" className="min-h-5">
        {state.error !== null ? (
          <p id="login-error" role="alert" className="text-[13px] text-[var(--danger)]">
            {state.error}
          </p>
        ) : null}
      </div>
      <DashButton type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </DashButton>
    </form>
  );
}
