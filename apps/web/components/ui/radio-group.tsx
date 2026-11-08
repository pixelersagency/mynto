import { cn } from '@/lib/utils';

/**
 * One choice among a few options. Native radios in a fieldset: arrow keys
 * move between options, labels and form posting stay native, and it works
 * before hydration. Two looks:
 * - `cards`: option cards with a radio ring, a title, a description and an
 *   optional aside (site type, report template, fonts);
 * - `segmented`: a compact segmented control for 2 to 4 short options
 *   (provider choice).
 * Uncontrolled with `defaultValue`, controlled with `value` + `onValueChange`.
 */
export interface RadioOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Small muted text on the right of a card. */
  aside?: React.ReactNode;
  /** Inline style of the label (font previews). */
  labelStyle?: React.CSSProperties;
  disabled?: boolean;
}

export function RadioGroup({
  name,
  legend,
  hint,
  options,
  variant = 'cards',
  columns = 1,
  defaultValue,
  value,
  onValueChange,
  idPrefix,
  legendClassName,
  className,
}: {
  name: string;
  legend: React.ReactNode;
  hint?: React.ReactNode;
  options: readonly RadioOption[];
  variant?: 'cards' | 'segmented';
  /** Cards only: 2 columns from the `sm` breakpoint. */
  columns?: 1 | 2;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  /** Prefix of the element ids (defaults to the field name). */
  idPrefix?: string;
  legendClassName?: string;
  className?: string;
}): React.ReactElement {
  const prefix = idPrefix ?? name;
  const hintId = hint ? `${prefix}-hint` : undefined;
  const controlled = value !== undefined;
  const state = (v: string): { checked?: boolean; defaultChecked?: boolean } =>
    controlled ? { checked: value === v } : { defaultChecked: defaultValue === v };
  const onChange = onValueChange
    ? (e: React.ChangeEvent<HTMLInputElement>): void => {
        onValueChange(e.target.value);
      }
    : undefined;

  return (
    <fieldset aria-describedby={hintId} className={className}>
      <legend className={cn('text-[13px] font-medium', legendClassName)}>{legend}</legend>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
          {hint}
        </p>
      ) : null}

      {variant === 'segmented' ? (
        <div className="mt-2 inline-flex max-w-full flex-wrap gap-0.5 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] p-0.5">
          {options.map((o) => {
            const id = `${prefix}-${o.value}`;
            return (
              <label
                key={o.value}
                htmlFor={id}
                className={cn(
                  'dash-option relative flex h-7 cursor-pointer items-center rounded-[5px] border border-transparent px-3 text-[13px] text-[var(--fg-muted)] hover:text-[var(--fg)]',
                  'has-[:checked]:border-[var(--control)] has-[:checked]:bg-[var(--bg)] has-[:checked]:font-medium has-[:checked]:text-[var(--fg)]',
                  'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={o.value}
                  disabled={o.disabled}
                  onChange={onChange}
                  className="sr-only"
                  {...state(o.value)}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      ) : (
        <div className={cn('mt-2 grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
          {options.map((o) => {
            const id = `${prefix}-${o.value}`;
            const descId = o.description ? `${id}-desc` : undefined;
            return (
              <label
                key={o.value}
                htmlFor={id}
                className={cn(
                  'dash-option flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border)] px-3 py-2 text-[13px] leading-5 hover:bg-[var(--bg-hover)]',
                  'has-[:checked]:border-[var(--accent)] has-[:checked]:hover:bg-transparent',
                  'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
                  'motion-safe:transition-colors',
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={o.value}
                  disabled={o.disabled}
                  aria-labelledby={`${id}-label`}
                  aria-describedby={descId}
                  onChange={onChange}
                  className="dash-radio mt-0.5"
                  {...state(o.value)}
                />
                <span className="min-w-0 flex-1">
                  <span id={`${id}-label`} className="block font-medium" style={o.labelStyle}>
                    {o.label}
                  </span>
                  {o.description ? (
                    <span id={descId} className="block text-[12px] text-[var(--fg-muted)]">
                      {o.description}
                    </span>
                  ) : null}
                </span>
                {o.aside ? (
                  <span className="mt-0.5 shrink-0 text-[11px] text-[var(--fg-muted)]">
                    {o.aside}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
