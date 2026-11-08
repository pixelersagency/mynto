import { WEBHOOK_EVENT_LABEL, type WebhookEventType } from '@mynto/shared';

import { cn } from '@/lib/utils';

/** Small presentational pieces of Réglages > Webhooks (server and client safe). */

export function dateTime(iso: string | null): string {
  if (iso === null) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

export function eventLabel(type: WebhookEventType): string {
  return WEBHOOK_EVENT_LABEL[type];
}

type Tone = 'success' | 'danger' | 'warning' | 'gray' | 'accent';

/** One small dot for the states that need an eye; the normal state stays plain. */
const DOT: Partial<Record<Tone, string>> = {
  danger: 'bg-[var(--danger)]',
  warning: 'bg-[var(--warning)]',
  accent: 'bg-[var(--accent)]',
};

/** A state in words, with at most one small marker (no filled pill). */
export function Pill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const dot = DOT[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]',
        tone === 'danger' && 'font-medium text-[var(--danger)]',
        tone === 'gray' && 'text-[var(--fg-muted)]',
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', dot)} /> : null}
      {children}
    </span>
  );
}

/** Status of a delivery, never by color alone (icon + text). */
export function DeliveryStatus({
  status,
  attempts,
}: {
  status: 'pending' | 'success' | 'failed';
  attempts: number;
}): React.ReactElement {
  if (status === 'success') {
    return <Pill tone="success">Réussi</Pill>;
  }
  if (status === 'failed') {
    return <Pill tone="danger">Échec</Pill>;
  }
  return <Pill tone="accent">{attempts === 0 ? 'En file' : 'Nouvel essai prévu'}</Pill>;
}

/** Last status of an endpoint for the list. */
export function EndpointStatus({
  active,
  disabledReason,
  lastStatus,
  lastCode,
}: {
  active: boolean;
  disabledReason: 'auto' | 'env_removed' | null;
  lastStatus: 'success' | 'failed' | null;
  lastCode: number | null;
}): React.ReactElement {
  if (!active && disabledReason === 'auto') {
    return <Pill tone="danger">Désactivé après 20 échecs</Pill>;
  }
  if (!active) {
    return (
      <Pill tone="gray">{disabledReason === 'env_removed' ? 'Retiré du .env' : 'Inactif'}</Pill>
    );
  }
  if (lastStatus === null) return <Pill tone="gray">Jamais appelé</Pill>;
  if (lastStatus === 'success') {
    return <Pill tone="success">{lastCode !== null ? `OK ${String(lastCode)}` : 'OK'}</Pill>;
  }
  return (
    <Pill tone="warning">{lastCode !== null ? `Erreur ${String(lastCode)}` : 'Injoignable'}</Pill>
  );
}

const ERROR_LABEL: Record<string, string> = {
  timeout: 'Délai dépassé (10 s)',
  network_error: 'Connexion impossible',
  redirect_refused: 'Redirection refusée',
  secret_unavailable: 'Secret illisible (APP_ENCRYPTION_KEY)',
  endpoint_disabled: 'Webhook désactivé',
  'blocked_target:private_target': 'Adresse privée refusée',
  'blocked_target:https_required': 'HTTPS exigé',
  'blocked_target:dns_error': 'Nom de domaine introuvable',
};

/** Readable cause of a failed attempt. */
export function errorLabel(error: string | null): string | null {
  if (error === null) return null;
  if (error.startsWith('http_')) return `Réponse HTTP ${error.slice(5)}`;
  return ERROR_LABEL[error] ?? error;
}
