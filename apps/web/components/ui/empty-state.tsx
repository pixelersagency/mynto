import { cn } from '@/lib/utils';

/**
 * Empty list or page: centred horizontally and vertically in the space it is
 * given (it grows with `flex-1` inside a flex column), text centred on at
 * most 420 px, the action under it. No illustration.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-1 items-center justify-center px-4 py-16', className)}>
      <div className="w-full max-w-[420px] text-center">
        <p className="text-[14px] font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-[13px] text-[var(--fg-muted)]">{description}</p>
        ) : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
