import { niceMax, shortDay } from '@/lib/dashboard/analytics';
import { cn } from '@/lib/utils';

/**
 * Hand-made charts of the Analytics page (no chart library), following the
 * dataviz skill: thin marks, 4px rounded data-ends square at the baseline,
 * 2px surface gaps between stacked segments, hairline grid, legend for >= 2
 * series, text in text tokens, a native tooltip (<title>) per mark and a
 * table view for every chart.
 */

export function Panel({
  id,
  title,
  subtitle,
  children,
  table,
  className,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Text alternative: the data as a table, in a disclosure. */
  table?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section aria-labelledby={`${id}-title`} className={cn('flex min-w-0 flex-col', className)}>
      <h2 id={`${id}-title`} className="dash-heading">
        {title}
      </h2>
      {subtitle ? <p className="mt-1 text-[13px] text-[var(--fg-muted)]">{subtitle}</p> : null}
      <div className="mt-6 flex-1">{children}</div>
      {table ? (
        <details className="mt-4 text-[12px]">
          <summary className="cursor-pointer text-[var(--fg-muted)] hover:text-[var(--fg)]">
            Voir les données
          </summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      ) : null}
    </section>
  );
}

export function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}): React.ReactElement {
  return (
    <table className="w-full border-collapse text-[12px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={cn(
                'border-b border-[var(--border)] py-1 pr-3 font-medium text-[var(--fg-muted)]',
                i === 0 ? 'text-left' : 'text-right',
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])} className="border-b border-[var(--border)] last:border-0">
            {r.map((c, i) => (
              <td
                key={i}
                className={cn('py-1 pr-3 tabular-nums', i === 0 ? 'text-left' : 'text-right')}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] text-[var(--fg-muted)]">{label}</p>
      <p className="dash-num text-[34px] leading-tight">{value}</p>
      {detail ? <p className="text-[12px] text-[var(--fg-muted)]">{detail}</p> : null}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; color: string }[];
}): React.ReactElement {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--fg-muted)]">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: it.color }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Path of a column with a 4px rounded top and a square base. */
function topRoundedRect(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return [
    `M${String(x)},${String(y + h)}`,
    `V${String(y + rr)}`,
    `Q${String(x)},${String(y)} ${String(x + rr)},${String(y)}`,
    `H${String(x + w - rr)}`,
    `Q${String(x + w)},${String(y)} ${String(x + w)},${String(y + rr)}`,
    `V${String(y + h)}`,
    'Z',
  ].join(' ');
}

export interface StackSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Stacked columns, one per week. Segments are separated by a 2px surface
 * gap; only the top segment gets the rounded data-end.
 */
export function StackedColumns({
  data,
  series,
  label,
}: {
  data: ({ week_start: string } & Record<string, number | string>)[];
  series: StackSeries[];
  /** Accessible name of the figure. */
  label: string;
}): React.ReactElement {
  const W = 640;
  const H = 200;
  const padL = 28;
  const padB = 22;
  const padT = 8;
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const totals = data.map((d) => series.reduce((n, s) => n + Number(d[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const band = plotW / Math.max(data.length, 1);
  const barW = Math.min(16, band * 0.5);
  const y = (v: number): number => padT + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = data.length > 8 ? Math.ceil(data.length / 7) : 1;

  return (
    <svg
      viewBox={`0 0 ${String(W)} ${String(H)}`}
      className="h-auto w-full"
      role="img"
      aria-label={label}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--fg-muted)">
            {t}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = padL + band * i + band / 2;
        let acc = 0;
        const parts = series.map((s) => ({ s, v: Number(d[s.key] ?? 0) })).filter((p) => p.v > 0);
        const total = totals[i] ?? 0;
        return (
          <g key={d.week_start}>
            <title>
              {`Semaine du ${shortDay(d.week_start)} : ${String(total)} audit${total > 1 ? 's' : ''}${parts.length > 0 ? ` (${parts.map((p) => `${p.s.label.toLowerCase()} ${String(p.v)}`).join(', ')})` : ''}`}
            </title>
            {/* Hit target wider than the mark. */}
            <rect x={cx - band / 2} y={padT} width={band} height={plotH} fill="transparent" />
            {parts.map((p, j) => {
              const top = j === parts.length - 1;
              const y0 = y(acc);
              const y1 = y(acc + p.v);
              acc += p.v;
              // 2px surface gap below every segment except the first.
              const gap = j > 0 ? 2 : 0;
              const h = Math.max(0, y0 - y1 - gap);
              return top ? (
                <path
                  key={p.s.key}
                  d={topRoundedRect(cx - barW / 2, y1, barW, h)}
                  fill={p.s.color}
                />
              ) : (
                <rect
                  key={p.s.key}
                  x={cx - barW / 2}
                  y={y1}
                  width={barW}
                  height={h}
                  fill={p.s.color}
                />
              );
            })}
            {i % labelEvery === 0 ? (
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--fg-muted)">
                {shortDay(d.week_start)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Horizontal bars in HTML (wraps and reflows at any width): 2px rules on a
 * warm track, value at the end. `tone` colours a bar from its value (score
 * bars: ink when good, warning when it needs attention); the value is
 * always written. `null` values render a muted note instead of a bar
 * (never a 0).
 */
export function HBars({
  rows,
  max,
  format = (v) => String(v),
  emptyLabel = 'Pas de donnée',
  color = 'var(--viz-mute-1)',
  tone,
  note,
}: {
  rows: { key: string; label: string; value: number | null; title?: string }[];
  max: number;
  format?: (v: number) => string;
  emptyLabel?: string;
  color?: string;
  tone?: (value: number) => string;
  /** Word after the value (e.g. the score band), so colour is never alone. */
  note?: (value: number) => string;
}): React.ReactElement {
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(84px,30%)_1fr] items-center gap-4 py-1 text-[13px]"
          title={r.title}
        >
          <span className="truncate text-[var(--fg)]">{r.label}</span>
          {r.value === null ? (
            <span className="text-[var(--fg-muted)]">{emptyLabel}</span>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-[2px] min-w-0 flex-1 bg-[var(--viz-track)]" aria-hidden="true">
                <span
                  className="block h-full"
                  style={{
                    width: `${String(Math.max(1, Math.min(100, (r.value / Math.max(max, 1)) * 100)))}%`,
                    background: tone ? tone(r.value) : color,
                  }}
                />
              </span>
              <span className="min-w-10 shrink-0 text-right tabular-nums text-[var(--fg)]">
                {format(r.value)}
                {note ? <span className="text-[var(--fg-muted)]"> · {note(r.value)}</span> : null}
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Thin segmented bar (one whole split into parts), 8px, legend carries the numbers. */
export function SegmentedBar({
  parts,
  label,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
  label: string;
}): React.ReactElement {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div>
      <div className="flex h-[3px] w-full gap-[2px]" role="img" aria-label={label}>
        {total === 0 ? (
          <span className="h-full w-full bg-[var(--viz-track)]" />
        ) : (
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span
                key={p.key}
                className="h-full"
                style={{ width: `${String((p.value / total) * 100)}%`, background: p.color }}
                title={`${p.label} : ${String(p.value)} (${String(Math.round((p.value / total) * 100))} %)`}
              />
            ))
        )}
      </div>
      <ul className="mt-3 space-y-1.5 text-[12px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: p.color }}
            />
            <span className="flex-1 text-[var(--fg)]">{p.label}</span>
            <span className="tabular-nums text-[var(--fg-muted)]">
              {p.value}
              {total > 0 ? ` (${String(Math.round((p.value / total) * 100))} %)` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
