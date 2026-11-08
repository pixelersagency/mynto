import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** Dashboard buttons: compact, hairline secondary, single blue primary. */
export const dashButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]',
        secondary:
          'border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:bg-[var(--bg-hover)]',
        ghost: 'text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
        danger: 'bg-[var(--danger)] text-white hover:opacity-90',
      },
      size: {
        sm: 'h-7 px-2',
        md: 'h-8 px-3',
        lg: 'h-10 px-4 text-sm',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface DashButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof dashButtonVariants> {
  asChild?: boolean;
}

export const DashButton = React.forwardRef<HTMLButtonElement, DashButtonProps>(function DashButton(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp ref={ref} className={cn(dashButtonVariants({ variant, size }), className)} {...props} />
  );
});
