'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * On/off switch for a boolean setting (Radix: a button with role="switch"
 * and aria-checked, Space and Enter toggle it). Inside a form it posts
 * `name=value` ("on" by default) when on, like a checkbox, so the server
 * actions read it unchanged. Keep checkboxes for row selection in tables.
 */
export const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-[var(--control)]',
        'data-[state=checked]:bg-[var(--accent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'motion-safe:transition-colors motion-safe:duration-150',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-[var(--control-thumb)] shadow-[0_1px_2px_rgb(0_0_0/0.2)]',
          'data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-[var(--accent-fg)]',
          'motion-safe:transition-transform motion-safe:duration-150',
        )}
      />
    </SwitchPrimitive.Root>
  );
});

/**
 * A switch with its label and an optional description, the switch on the
 * left of the text (same row layout as the former checkboxes).
 */
export function SwitchField({
  id,
  label,
  description,
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, 'id' | 'children'> & {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
}): React.ReactElement {
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Switch id={id} aria-describedby={descId} className="mt-px" {...props} />
      <div className="min-w-0 text-[13px] leading-5">
        <label htmlFor={id} className="cursor-pointer font-medium">
          {label}
        </label>
        {description ? (
          <span id={descId} className="block text-[12px] text-[var(--fg-muted)]">
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}
