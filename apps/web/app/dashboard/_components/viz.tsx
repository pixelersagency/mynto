import { SCORE_BAND_LABEL, scoreBand } from '@/lib/scores';
import { cn } from '@/lib/utils';

/**
 * Small charts of the dashboard (pure SVG, server-rendered). Data viz tokens
 * of globals.css (--viz-*, validated palette). Every chart carries its values
 * in text (labels, <title> on marks, an sr-only list): never color alone.
 */

/**
 * Global score /100 as a figure: the number, the band in words with its
 * one colored marker, and the change since the last scan.
 */
export function ScoreFigure({
  value,
  delta = null,
  label = 'Score global',
}: {
  value: number;
  delta?: number | null;
  label?: string;
}): React.ReactElement {
  const band = scoreBand(value);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="dash-label">{label}</figcaption>
      <p className="flex items-baseline gap-1 tabular-nums">
        <span className="dash-num text-[48px] leading-none">{value}</span>
        <span className="text-[13px] text-[var(--fg-muted)]">/100</span>
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px]">
        <span
          aria-hidden="true"
          className={cn('inline-block h-1.5 w-1.5 rounded-[2px]', BAND_BG[band])}
        />
        {SCORE_BAND_LABEL[band]}
      </p>
      {delta !== null && delta !== 0 ? (
        <p className="whitespace-nowrap text-[12px] tabular-nums text-[var(--fg-muted)]">
          <span aria-hidden="true">{delta > 0 ? '↑ +' : '↓ '}</span>
          <span className="sr-only">{delta > 0 ? 'En hausse de ' : 'En baisse de '}</span>
          {Math.abs(delta)} depuis le scan précédent
        </p>
      ) : null}
    </figure>
  );
}

const BAND_BG = {
  good: 'bg-[var(--success)]',
  fair: 'bg-[var(--warning)]',
  poor: 'bg-[var(--danger)]',
} as const;

export interface RadarAxis {
  key: string;
  short: string;
  label: string;
  value: number | null;
}

/**
 * Radar of the axis scores (one series). Rings at 50 and 80 mark the band
 * thresholds. Axes not evaluated keep a dashed spoke and no point.
 */
export function AxisRadar({
  axes,
  size = 232,
}: {
  axes: RadarAxis[];
  size?: number;
}): React.ReactElement {
  const cx = 120;
  const cy = 112;
  const R = 74;
  const n = axes.length;
  const angle = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number): [number, number] => [
    cx + (Math.cos(angle(i)) * (R * v)) / 100,
    cy + (Math.sin(angle(i)) * (R * v)) / 100,
  ];
  const ring = (v: number): string =>
    axes
      .map((_, i) =>
        pt(i, v)
          .map((x) => x.toFixed(1))
          .join(','),
      )
      .join(' ');
  const scored = axes
    .map((a, i) => ({ a, i }))
    .filter((x): x is { a: RadarAxis & { value: number }; i: number } => x.a.value !== null);
  const poly = scored
    .map(({ a, i }) =>
      pt(i, a.value)
        .map((x) => x.toFixed(1))
        .join(','),
    )
    .join(' ');
  return (
    <figure>
      <svg
        viewBox="0 0 240 228"
        width={size}
        height={(size * 228) / 240}
        role="img"
        aria-label="Scores par axe sur 100"
        className="overflow-visible"
      >
        {[100, 80, 50].map((v) => (
          <polygon
            key={v}
            points={ring(v)}
            fill="none"
            stroke="var(--viz-grid)"
            strokeWidth="1"
            strokeDasharray={v === 100 ? undefined : '3 3'}
          />
        ))}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 100);
          return (
            <line
              key={a.key}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="var(--viz-grid)"
              strokeDasharray={a.value === null ? '2 3' : undefined}
            />
          );
        })}
        {scored.length >= 3 ? (
          <polygon
            points={poly}
            fill="var(--viz-1)"
            fillOpacity="0.05"
            stroke="var(--viz-1)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ) : null}
        {scored.map(({ a, i }) => {
          const [x, y] = pt(i, a.value);
          return (
            <circle
              key={a.key}
              cx={x}
              cy={y}
              r="2.5"
              fill="var(--viz-1)"
              stroke="var(--bg)"
              strokeWidth="2"
            >
              <title>{`${a.label} : ${String(a.value)}/100`}</title>
            </circle>
          );
        })}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 122);
          const cos = Math.cos(angle(i));
          const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
          return (
            <text
              key={a.key}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize="11"
              fill="var(--fg-muted)"
            >
              {a.short}
              <tspan fill="var(--fg)" fontWeight="600" dx="3">
                {a.value === null ? '-' : String(a.value)}
              </tspan>
            </text>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <ul>
          {axes.map((a) => (
            <li key={a.key}>
              {a.label} : {a.value === null ? 'non évalué' : `${String(a.value)} sur 100`}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** Score history between refreshes (one series, y fixed 0-100). */
export function ScoreSparkline({
  points,
  width = 168,
  height = 44,
}: {
  points: { date: string; label: string; value: number }[];
  width?: number;
  height?: number;
}): React.ReactElement {
  const pad = 5;
  const x = (i: number): number =>
    points.length <= 1 ? width - pad : pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number): number => pad + ((100 - v) * (height - 2 * pad)) / 100;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  return (
    <figure>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        role="img"
        aria-label="Évolution du score global"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={y(50)}
          y2={y(50)}
          stroke="var(--viz-grid)"
          strokeDasharray="2 3"
        />
        <line
          x1={pad}
          x2={width - pad}
          y1={y(80)}
          y2={y(80)}
          stroke="var(--viz-grid)"
          strokeDasharray="2 3"
        />
        {points.length > 1 ? (
          <path
            d={d}
            fill="none"
            stroke="var(--viz-1)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(p.value)}
            r={i === points.length - 1 ? 3.5 : 2.5}
            fill={i === points.length - 1 ? 'var(--viz-1)' : 'var(--bg)'}
            stroke="var(--viz-1)"
            strokeWidth="1.5"
          >
            <title>{`${p.label} : ${String(p.value)}/100`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="sr-only">
        {points.map((p) => `${p.label} : ${String(p.value)} sur 100`).join(', ')}
      </figcaption>
    </figure>
  );
}

/** Small up/down trend for a weekly figure (arrow + text, not color alone). */
export function Trend({
  current,
  previous,
  unit = '',
}: {
  current: number;
  previous: number;
  unit?: string;
}): React.ReactElement {
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) {
    return (
      <span className="whitespace-nowrap text-[12px] text-[var(--fg-muted)]">
        Stable vs semaine d’avant
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] tabular-nums text-[var(--fg-muted)]">
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
      <span className="text-[var(--fg)]">
        {up ? '+' : ''}
        {diff.toLocaleString('fr-FR')}
        {unit}
      </span>
      <span aria-hidden="true">vs semaine d’avant</span>
      <span className="sr-only">par rapport à la semaine d’avant</span>
    </span>
  );
}
