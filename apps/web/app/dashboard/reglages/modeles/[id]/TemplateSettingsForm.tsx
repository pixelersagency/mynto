'use client';

import type { RenderResult, SectionEntry, SettingValue, TemplateSetting } from '@mynto/templates';
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  previewTemplateAction,
  resetTemplateSettingsAction,
  saveTemplateSettingsAction,
} from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import { Switch, SwitchField } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const FIELD =
  'mt-1 w-full rounded-md border border-[var(--border-input)] bg-[var(--bg)] px-3 text-[14px] focus-visible:border-[var(--accent)]';

/** Settings form generated from the manifest, with a live preview of the template. */
export function TemplateSettingsForm({
  id,
  settings,
  initialValues,
  initialSections,
  sectionLabels,
  fonts,
  initialPreview,
}: {
  id: string;
  settings: TemplateSetting[];
  initialValues: Record<string, SettingValue>;
  initialSections: SectionEntry[];
  sectionLabels: Record<string, string>;
  fonts: { value: string; label: string }[];
  initialPreview: RenderResult;
}): React.ReactElement {
  const [values, setValues] = useState(initialValues);
  const [sections, setSections] = useState(initialSections);
  const [preview, setPreview] = useState(initialPreview);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();
  const first = useRef(true);

  const payload = (): Record<string, unknown> => ({ ...values, sections });

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void previewTemplateAction(id, payload()).then((r) => {
        if ('error' in r) setNote({ ok: false, text: r.error });
        else setPreview(r);
      });
    }, 300);
    return () => {
      window.clearTimeout(t);
    };
  }, [values, sections, id]);

  const set = (key: string, v: SettingValue): void => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };
  const move = (i: number, d: -1 | 1): void => {
    setSections((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      const a = next[i];
      const b = next[j];
      if (a === undefined || b === undefined) return prev;
      next[i] = b;
      next[j] = a;
      return next;
    });
  };

  return (
    <div className="mt-6 grid gap-8 xl:grid-cols-[400px_1fr]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveTemplateSettingsAction(id, payload());
            setNote({ ok: r.ok, text: r.message ?? '' });
          });
        }}
      >
        {settings.map((s) => {
          const fid = `tpl-${s.key}`;
          if (s.type === 'sections') {
            return (
              <fieldset key={s.key}>
                <legend className="text-[13px] font-medium">{s.label}</legend>
                {s.help ? <p className="text-[12px] text-[var(--fg-muted)]">{s.help}</p> : null}
                <ol className="mt-2 space-y-1">
                  {sections.map((sec, i) => (
                    <li
                      key={sec.id}
                      className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-[var(--bg-hover)]"
                    >
                      <Switch
                        id={`sec-${sec.id}`}
                        checked={sec.enabled}
                        onCheckedChange={(on) => {
                          setSections((prev) =>
                            prev.map((x) => (x.id === sec.id ? { ...x, enabled: on } : x)),
                          );
                        }}
                      />
                      <label
                        htmlFor={`sec-${sec.id}`}
                        className="flex-1 cursor-pointer text-[13px]"
                      >
                        {sectionLabels[sec.id] ?? sec.id}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          move(i, -1);
                        }}
                        disabled={i === 0}
                        className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] disabled:opacity-30"
                        aria-label={`Monter ${sectionLabels[sec.id] ?? sec.id}`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          move(i, 1);
                        }}
                        disabled={i === sections.length - 1}
                        className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-subtle)] disabled:opacity-30"
                        aria-label={`Descendre ${sectionLabels[sec.id] ?? sec.id}`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              </fieldset>
            );
          }
          if (s.type === 'boolean') {
            return (
              <SwitchField
                key={s.key}
                id={fid}
                checked={values[s.key] === true}
                onCheckedChange={(on) => {
                  set(s.key, on);
                }}
                label={s.label}
                description={s.help}
              />
            );
          }
          const options = s.type === 'select' ? s.options : s.type === 'font' ? fonts : null;
          return (
            <div key={s.key}>
              <label htmlFor={fid} className="text-[13px] font-medium">
                {s.label}
              </label>
              {options ? (
                <select
                  id={fid}
                  value={String(values[s.key] ?? '')}
                  onChange={(e) => {
                    set(s.key, e.target.value);
                  }}
                  className={cn(FIELD, 'h-9')}
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : s.type === 'textarea' ? (
                <textarea
                  id={fid}
                  rows={3}
                  maxLength={s.max}
                  value={String(values[s.key] ?? '')}
                  onChange={(e) => {
                    set(s.key, e.target.value);
                  }}
                  className={cn(FIELD, 'py-2')}
                />
              ) : (
                <input
                  id={fid}
                  maxLength={'max' in s ? s.max : 200}
                  value={String(values[s.key] ?? '')}
                  onChange={(e) => {
                    set(s.key, e.target.value);
                  }}
                  className={cn(FIELD, 'h-9')}
                />
              )}
              {s.help ? <p className="mt-1 text-[12px] text-[var(--fg-muted)]">{s.help}</p> : null}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
          <DashButton type="submit" variant="primary" disabled={saving}>
            Enregistrer
          </DashButton>
          <DashButton
            type="button"
            variant="ghost"
            onClick={() => {
              start(async () => {
                const r = await resetTemplateSettingsAction(id);
                setNote({ ok: r.ok, text: r.message ?? '' });
                window.location.reload();
              });
            }}
          >
            Revenir aux réglages par défaut
          </DashButton>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'text-[13px]',
            note?.ok === false ? 'text-[var(--danger)]' : 'text-[var(--success)]',
          )}
        >
          {note?.text}
        </p>
      </form>
      <section aria-labelledby="tpl-preview-title" className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="tpl-preview-title" className="text-[13px] font-medium">
            Aperçu en direct
          </h2>
          <span className="flex gap-1.5">
            <DashButton size="sm" variant="ghost" asChild>
              <a href={`/dashboard/reglages/modeles/${id}/apercu`} target="_blank" rel="noopener">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Web
                <span className="sr-only"> (enregistré, nouvel onglet)</span>
              </a>
            </DashButton>
            <DashButton size="sm" variant="ghost" asChild>
              <a
                href={`/dashboard/reglages/modeles/${id}/apercu?mode=print`}
                target="_blank"
                rel="noopener"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> PDF
                <span className="sr-only"> (enregistré, nouvel onglet)</span>
              </a>
            </DashButton>
          </span>
        </div>
        <div
          className="h-[78vh] overflow-auto rounded-lg border border-[var(--border)] bg-white"
          // Decorative mirror of the report: its links and buttons are not reachable.
          inert
        >
          <div style={{ zoom: 0.72 }}>
            <style
              dangerouslySetInnerHTML={{ __html: preview.css.replace(/<\/style/gi, '<\\/style') }}
            />
            <div
              dangerouslySetInnerHTML={{
                __html: preview.html
                  .replace(/<h1\b/g, '<p role="heading" aria-level="2"')
                  .replace(/<\/h1>/g, '</p>'),
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
