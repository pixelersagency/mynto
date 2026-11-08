'use client';

import { ExternalLink, RefreshCw, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { refreshAuditsAction } from '../../actions';
import { sendReportAction } from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Props {
  auditId: string;
  name: string;
  shareLink: string;
  previewHref: string;
  pdfHref: string;
  completed: boolean;
  running: boolean;
  smtpReady: boolean;
  defaultSubject: string;
  defaultBody: string;
}

/** Header actions of the audit record: copy, send, refresh, PDF, open. */
export function PanelActions(p: Props): React.ReactElement {
  const router = useRouter();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [sendOpen, setSendOpen] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      .writeText(p.shareLink)
      .then(() => {
        setNote({ text: 'Lien de suivi copié.', ok: true });
      })
      .catch(() => {
        setNote({ text: `Copie impossible. Le lien : ${p.shareLink}`, ok: false });
      });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          title={
            !p.completed
              ? 'Disponible quand l’audit est terminé.'
              : !p.smtpReady
                ? 'Configure ton SMTP dans Réglages, Email.'
                : undefined
          }
        >
          <DashButton
            size="sm"
            variant="primary"
            disabled={!p.completed || !p.smtpReady}
            onClick={() => {
              setSendOpen(true);
            }}
            aria-describedby={!p.smtpReady ? 'send-disabled-why' : undefined}
          >
            Envoyer le rapport
          </DashButton>
        </span>
        <DashButton size="sm" onClick={copy}>
          Copier le lien
        </DashButton>
        <DashButton
          size="sm"
          disabled={pending || p.running}
          onClick={() => {
            start(async () => {
              const res = await refreshAuditsAction([p.auditId]);
              setNote({ text: res.message, ok: res.ok });
              router.refresh();
            });
          }}
        >
          {pending ? (
            <RefreshCw className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
          ) : null}
          Rafraîchir
        </DashButton>
        {p.completed ? (
          <DashButton size="sm" asChild>
            <a href={p.pdfHref} download>
              PDF
            </a>
          </DashButton>
        ) : null}
        <DashButton size="sm" variant="ghost" asChild>
          <a href={p.previewHref} target="_blank" rel="noopener">
            Ouvrir le rapport
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
        </DashButton>
      </div>
      {!p.smtpReady && p.completed ? (
        <p id="send-disabled-why" className="mt-2 text-[12px] text-[var(--fg-muted)]">
          L’envoi par email demande ton serveur SMTP (Réglages, Email).
        </p>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          'mt-2 min-h-[1em] text-[12px]',
          note?.ok === false ? 'text-[var(--danger)]' : 'text-[var(--fg-muted)]',
        )}
      >
        {note?.text}
      </p>
      <SendDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        auditId={p.auditId}
        name={p.name}
        defaultSubject={p.defaultSubject}
        defaultBody={p.defaultBody}
        onSent={(text) => {
          setNote({ text, ok: true });
          router.refresh();
        }}
      />
    </div>
  );
}

function SendDialog({
  open,
  onOpenChange,
  auditId,
  name,
  defaultSubject,
  defaultBody,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auditId: string;
  name: string;
  defaultSubject: string;
  defaultBody: string;
  onSent: (message: string) => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const field =
    'mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] focus-visible:border-[var(--accent)]';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Envoyer le rapport de {name}</DialogTitle>
        <DialogDescription>
          Le message part de ton SMTP. Le lien envoyé est ton lien de suivi : tu sauras quand il est
          ouvert. Variables : {'{site}'}, {'{score}'}, {'{lien}'}, {'{agence}'}.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            start(async () => {
              const res = await sendReportAction({
                auditId,
                recipient: f.get('recipient'),
                subject: f.get('subject'),
                body: f.get('body'),
              });
              setFieldErrors(res.fieldErrors ?? {});
              if (res.ok) {
                setError(null);
                onOpenChange(false);
                onSent(res.message);
              } else setError(res.message);
            });
          }}
        >
          <div>
            <label htmlFor="send-recipient" className="text-[13px] font-medium">
              Destinataire
            </label>
            <input
              id="send-recipient"
              name="recipient"
              type="email"
              required
              autoComplete="off"
              placeholder="prenom@entreprise.fr"
              className={field}
              aria-invalid={fieldErrors.recipient ? true : undefined}
              aria-describedby={fieldErrors.recipient ? 'send-recipient-err' : undefined}
            />
            {fieldErrors.recipient ? (
              <p id="send-recipient-err" className="mt-1 text-[12px] text-[var(--danger)]">
                {fieldErrors.recipient}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="send-subject" className="text-[13px] font-medium">
              Objet
            </label>
            <input
              id="send-subject"
              name="subject"
              required
              maxLength={200}
              defaultValue={defaultSubject}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="send-body" className="text-[13px] font-medium">
              Message
            </label>
            <textarea
              id="send-body"
              name="body"
              required
              rows={9}
              maxLength={5000}
              defaultValue={defaultBody}
              className={cn(field, 'font-[inherit] leading-relaxed')}
            />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <DashButton type="button">Annuler</DashButton>
            </DialogClose>
            <DashButton type="submit" variant="primary" disabled={pending}>
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {pending ? 'Envoi…' : 'Envoyer'}
            </DashButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
