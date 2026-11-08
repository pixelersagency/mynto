/** Shared form field styles of the dashboard. */
export const INPUT_CLASS =
  'h-9 w-full rounded-md border border-[var(--border-input)] bg-[var(--bg)] px-3 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-muted)] focus-visible:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)]';

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-[var(--fg-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(
  id: string,
  hint: boolean,
  error: string | undefined,
): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}
