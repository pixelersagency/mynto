/** Agency logo, or its initial on a plain dark square when no logo is set (dashboard tokens). */
export function AgencyMark({
  name,
  logoUrl,
  size = 22,
}: {
  name: string;
  logoUrl: string | null;
  size?: number;
}): React.ReactElement {
  if (logoUrl !== null) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-md object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-md bg-[var(--fg)] font-semibold text-[var(--bg)]"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
      }}
    >
      {name.trim().charAt(0).toUpperCase() || 'A'}
    </span>
  );
}
