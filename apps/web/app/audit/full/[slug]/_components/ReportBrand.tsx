import { ArrowRight } from 'lucide-react';

import type { Branding } from '@/lib/branding';
import { readableTextOn } from '@/lib/color';

/**
 * Agency branding blocks of the public reports (/audit/full, /r/). Server
 * Components: the branding is read once per request (lib/branding).
 */

export function ReportBrandHeader({ brand }: { brand: Branding }): React.ReactElement {
  const inner = (
    <>
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="h-8 w-auto max-w-[160px] object-contain" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold"
          style={{ background: brand.primaryColor, color: readableTextOn(brand.primaryColor) }}
        >
          {brand.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-sm font-semibold">{brand.name}</span>
    </>
  );
  return (
    <div className="mb-10 flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
      {brand.websiteUrl ? (
        <a
          href={brand.websiteUrl}
          rel="noopener"
          className="flex items-center gap-2.5 hover:opacity-80"
        >
          {inner}
        </a>
      ) : (
        <span className="flex items-center gap-2.5">{inner}</span>
      )}
      <span className="text-xs text-[var(--color-muted-foreground)]">Audit web sur 8 axes</span>
    </div>
  );
}

export function ReportContactCta({ brand }: { brand: Branding }): React.ReactElement | null {
  if (brand.contactUrl === null) return null;
  const fg = readableTextOn(brand.primaryColor);
  return (
    <section
      aria-labelledby="contact-cta-title"
      className="mt-10 rounded-xl border p-6 sm:flex sm:items-center sm:justify-between sm:gap-6"
      style={{ borderColor: brand.primaryColor }}
    >
      <div>
        <h2 id="contact-cta-title" className="text-lg font-semibold">
          Tu veux corriger ces points ?
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {brand.name} peut t’aider à prioriser et à faire les corrections.
        </p>
      </div>
      <a
        href={brand.contactUrl}
        rel="noopener"
        className="mt-4 inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium sm:mt-0"
        style={{ background: brand.primaryColor, color: fg }}
      >
        Prendre contact
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </section>
  );
}

export function ReportFooter({
  brand,
  children,
}: {
  brand: Branding;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <footer className="mt-12 space-y-2 border-t border-[var(--color-border)] pt-6 text-xs text-[var(--color-muted-foreground)]">
      {children}
      {brand.footer ? <p className="whitespace-pre-line">{brand.footer}</p> : null}
      <p>
        Rapport préparé par{' '}
        {brand.websiteUrl ? (
          <a href={brand.websiteUrl} rel="noopener" className="underline underline-offset-2">
            {brand.name}
          </a>
        ) : (
          brand.name
        )}
        .
      </p>
    </footer>
  );
}
