'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** Dashboard dialog (Radix: focus trap, Escape, aria-labelledby/describedby). */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <div className="dash" style={{ display: 'contents' }}>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5 text-[var(--fg)] shadow-[var(--shadow-pop)]',
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-md p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-hover)]"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
});

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>): React.ReactElement {
  return <DialogPrimitive.Title className={cn('dash-heading pr-8', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): React.ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn('mt-2 text-[13px] leading-relaxed text-[var(--fg-muted)]', className)}
      {...props}
    />
  );
}
