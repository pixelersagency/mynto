'use client';

import { Copy, Download, Eye, MoreHorizontal, Power, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';

import {
  deleteTemplateAction,
  duplicateTemplateAction,
  importTemplateAction,
  setDefaultTemplateAction,
  setTemplateEnabledAction,
  type TemplateActionState,
} from './actions';

import { DashButton } from '@/components/ui/dash-button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SwitchField } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface TemplateCardData {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  enabled: boolean;
  isDefault: boolean;
  basedOn: string | null;
  hasPreview: boolean;
  audits: number;
}

const INITIAL: TemplateActionState = { ok: false, message: null };
const FIELD =
  'mt-1 h-9 w-full rounded-md border border-[var(--border-input)] bg-[var(--bg)] px-3 text-[14px]';

function Issues({ state }: { state: TemplateActionState }): React.ReactElement | null {
  if (!state.message) return null;
  return (
    <div
      role={state.ok ? 'status' : 'alert'}
      className={cn('text-[13px]', state.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}
    >
      <p>{state.message}</p>
      {state.issues && state.issues.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-[12px]">
          {state.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TemplateCard({ t }: { t: TemplateCardData }): React.ReactElement {
  const [note, setNote] = useState<TemplateActionState | null>(null);
  const [pending, start] = useTransition();
  const [dup, setDup] = useState(false);
  const [del, setDel] = useState(false);
  const run = (fn: () => Promise<TemplateActionState>): void => {
    start(async () => {
      setNote(await fn());
    });
  };
  return (
    <li className={cn('flex flex-col', !t.enabled && 'opacity-70')}>
      <a
        href={`/dashboard/reglages/modeles/${t.id}/apercu`}
        target="_blank"
        rel="noopener"
        className="group relative block aspect-[4/3] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-subtle)]"
      >
        {t.hasPreview ? (
          <img
            src={`/dashboard/reglages/modeles/${t.id}/vignette`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-[13px] text-[var(--fg-muted)]">
            Pas d’aperçu
          </span>
        )}
        <span className="sr-only">Aperçu de {t.name} (nouvel onglet)</span>
      </a>
      <div className="flex flex-1 flex-col gap-2 pt-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-baseline gap-2 text-[14px] font-medium">
              {t.name}
              {t.isDefault ? (
                <span className="text-[12px] font-normal text-[var(--fg-muted)]">par défaut</span>
              ) : null}
              {!t.enabled ? (
                <span className="text-[12px] font-normal text-[var(--fg-muted)]">désactivé</span>
              ) : null}
            </h3>
            <p className="text-[12px] text-[var(--fg-muted)]">
              {t.builtin ? 'Fourni' : t.basedOn ? `D’après ${t.basedOn}` : 'Importé'}, version{' '}
              {t.version}, {t.audits} audit{t.audits > 1 ? 's' : ''}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)]"
              aria-label={`Actions pour ${t.name}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a
                  href={`/dashboard/reglages/modeles/${t.id}/apercu`}
                  target="_blank"
                  rel="noopener"
                >
                  <Eye className="h-4 w-4" aria-hidden="true" /> Aperçu web
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={`/dashboard/reglages/modeles/${t.id}/apercu?mode=print`}
                  target="_blank"
                  rel="noopener"
                >
                  <Eye className="h-4 w-4" aria-hidden="true" /> Aperçu PDF
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setDup(true);
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" /> Dupliquer
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/dashboard/reglages/modeles/${t.id}/export`} download>
                  <Download className="h-4 w-4" aria-hidden="true" /> Exporter en .zip
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={t.isDefault}
                onSelect={() => {
                  run(() => setTemplateEnabledAction(t.id, !t.enabled));
                }}
              >
                <Power className="h-4 w-4" aria-hidden="true" />{' '}
                {t.enabled ? 'Désactiver' : 'Activer'}
              </DropdownMenuItem>
              {!t.builtin ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={() => {
                      setDel(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Supprimer
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="line-clamp-2 text-[13px] text-[var(--fg-muted)]">{t.description}</p>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <DashButton size="sm" asChild>
            <Link href={`/dashboard/reglages/modeles/${t.id}` as '/dashboard'}>Réglages</Link>
          </DashButton>
          {!t.isDefault ? (
            <DashButton
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                run(() => setDefaultTemplateAction(t.id));
              }}
            >
              Par défaut
            </DashButton>
          ) : null}
        </div>
        <div aria-live="polite">{note ? <Issues state={note} /> : null}</div>
      </div>
      <DuplicateDialog open={dup} onOpenChange={setDup} source={t} />
      <Dialog open={del} onOpenChange={setDel}>
        <DialogContent>
          <DialogTitle>Supprimer « {t.name} » ?</DialogTitle>
          <DialogDescription>
            Les audits qui l’utilisent passent au modèle par défaut. Exporte-le d’abord si tu veux
            le garder.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <DashButton>Annuler</DashButton>
            </DialogClose>
            <DashButton
              variant="danger"
              onClick={() => {
                setDel(false);
                run(() => deleteTemplateAction(t.id));
              }}
            >
              Supprimer
            </DashButton>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function DuplicateDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: TemplateCardData;
}): React.ReactElement {
  const [state, action, pending] = useActionState(duplicateTemplateAction, INITIAL);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Dupliquer « {source.name} »</DialogTitle>
        <DialogDescription>
          La copie garde ses réglages. Tu peux ensuite l’exporter pour la modifier.
        </DialogDescription>
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="source" value={source.id} />
          <div>
            <label htmlFor={`dup-name-${source.id}`} className="text-[13px] font-medium">
              Nom
            </label>
            <input
              id={`dup-name-${source.id}`}
              name="name"
              required
              maxLength={60}
              defaultValue={`${source.name} agence`}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor={`dup-id-${source.id}`} className="text-[13px] font-medium">
              Identifiant
            </label>
            <input
              id={`dup-id-${source.id}`}
              name="id"
              required
              pattern="[a-z][a-z0-9-]{1,39}"
              defaultValue={`${source.id}-agence`}
              aria-describedby={`dup-id-hint-${source.id}`}
              className={FIELD}
            />
            <p id={`dup-id-hint-${source.id}`} className="mt-1 text-[12px] text-[var(--fg-muted)]">
              Minuscules, chiffres et tirets. Il sert de nom de dossier et dans l’API.
            </p>
          </div>
          <Issues state={state} />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <DashButton type="button">Fermer</DashButton>
            </DialogClose>
            <DashButton type="submit" variant="primary" disabled={pending}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Dupliquer
            </DashButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ImportTemplate(): React.ReactElement {
  const [state, action, pending] = useActionState(importTemplateAction, INITIAL);
  const [open, setOpen] = useState(false);
  return (
    <>
      <DashButton
        variant="primary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Importer un .zip
      </DashButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Importer un modèle</DialogTitle>
          <DialogDescription>
            Archive .zip de 2 Mo au plus : manifest.json, report.liquid, sections/*.liquid,
            report.css, print.css, preview.png. Pas de script, pas de ressource externe.
          </DialogDescription>
          <form action={action} className="mt-4 space-y-3">
            <div>
              <label htmlFor="tpl-zip" className="text-[13px] font-medium">
                Fichier
              </label>
              <input
                id="tpl-zip"
                name="zip"
                type="file"
                accept=".zip,application/zip"
                required
                className="mt-1 block w-full text-[13px]"
              />
            </div>
            <SwitchField
              id="tpl-replace"
              name="replace"
              label="Remplacer le modèle s’il existe déjà"
            />
            <Issues state={state} />
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <DashButton type="button">Fermer</DashButton>
              </DialogClose>
              <DashButton type="submit" variant="primary" disabled={pending}>
                {pending ? 'Vérification…' : 'Importer'}
              </DashButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
