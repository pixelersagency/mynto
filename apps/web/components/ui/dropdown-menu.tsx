'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Dashboard dropdown (Radix: roving focus, arrow keys, Escape, typeahead).
 * Styled with the .dash tokens.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <div className="dash" style={{ display: 'contents' }}>
        <DropdownMenuPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            'z-50 min-w-[200px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 text-[13px] text-[var(--fg)] shadow-[var(--shadow-pop)]',
            className,
          )}
          {...props}
        />
      </div>
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }
>(function DropdownMenuItem({ className, destructive, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        'flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-[var(--bg-hover)] data-[disabled]:opacity-50',
        destructive && 'text-[var(--danger)]',
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      className={cn(
        'flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-[var(--bg-hover)]',
        className,
      )}
      {...props}
    >
      <span className="flex w-4 justify-center" aria-hidden="true">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="block h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 pb-1 pt-2 text-[12px] text-[var(--fg-muted)]', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>): React.ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-[var(--border)]', className)}
      {...props}
    />
  );
}
