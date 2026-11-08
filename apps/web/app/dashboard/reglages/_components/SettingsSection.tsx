/**
 * One group of a settings page: title and short explanation on the left
 * (above on narrow screens), the form on the right. Groups are separated by
 * a hairline, never boxed.
 */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-10 gap-y-4 py-10 lg:grid-cols-[200px_minmax(0,1fr)]"
    >
      <div>
        <h2 id={id} className="dash-heading">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--fg-muted)]">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
