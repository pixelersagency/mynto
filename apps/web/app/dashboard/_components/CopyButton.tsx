'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ value, label }: { value: string; label: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => {
            setCopied(false);
          }, 1_500);
        });
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
      aria-label={copied ? 'Lien copié' : label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
