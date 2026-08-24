import { formatCurrency } from "./transactions";

export interface SparkPoint {
  value: number;
}

interface SparklineProps {
  points: SparkPoint[];
  ariaLabel?: string;
  stroke?: string;
  fillGradientId?: string;
  className?: string;
}

export function Sparkline({
  points,
  ariaLabel = "Trend",
  stroke = "#4d8dff",
  fillGradientId = "sparkFill",
  className = "block w-full h-auto mt-4 max-w-[640px]",
}: SparklineProps) {
  const w = 640;
  const h = 100;
  if (points.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h + 20}`} className={className} role="img" />
    );
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const pts = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.value - min) / span) * (h - 12) - 6;
      return `${x},${y}`;
    })
    .join(" ");
  const [first, ...rest] = pts.split(" ");
  const path = `M${first} L${rest.join(" L")}`;
  const fillPath = `${path} L${w},${h + 20} L0,${h + 20} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h + 20}`}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${fillGradientId})`} />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface DonutBucket {
  key: string;
  label: string;
  value: number;
}

interface DonutProps {
  buckets: DonutBucket[];
  total: number;
  colors: string[];
  centerLabel?: string;
  centerValueText?: string;
  size?: number;
}

export function Donut({
  buckets,
  total,
  colors,
  centerLabel,
  centerValueText,
  size = 150,
}: DonutProps) {
  const r = (size / 150) * 62;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  let offset = 0;
  const centerText = centerValueText ?? formatCurrency(total, { max: 0 });
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <g transform={`rotate(-90 ${cx} ${cy})`} fill="none" strokeLinecap="round">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="rgba(255,255,255,.06)"
          strokeWidth="11"
        />
        {buckets.map((b, i) => {
          const frac = total > 0 ? b.value / total : 0;
          const dash = frac * c;
          const el = (
            <circle
              key={b.key}
              cx={cx}
              cy={cy}
              r={r}
              stroke={colors[i % colors.length]}
              strokeWidth="11"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </g>
      {centerLabel && (
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill="rgba(242,243,245,.4)"
          style={{ font: "500 9.5px Archivo", letterSpacing: "0.14em" }}
        >
          {centerLabel}
        </text>
      )}
      <text
        x={cx}
        y={cy + 15}
        textAnchor="middle"
        fill="#f2f3f5"
        style={{ font: "700 19px Archivo" }}
      >
        {centerText}
      </text>
    </svg>
  );
}
