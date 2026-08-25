import { useRef, useState } from "react";
import { formatCurrency, formatShortMonthDay } from "./transactions";

export interface SparkPoint {
  date: string;
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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

  const coords = points.map((p, i) => ({
    x: i * step,
    y: h - ((p.value - min) / span) * (h - 12) - 6,
  }));

  const pts = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const [first, ...rest] = pts.split(" ");
  const path = `M${first} L${rest.join(" L")}`;
  const fillPath = `${path} L${w},${h + 20} L0,${h + 20} Z`;

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * w;
    const i = Math.max(
      0,
      Math.min(points.length - 1, Math.round(relX / step))
    );
    setHoverIdx(i);
  };

  const hovered = hoverIdx !== null ? coords[hoverIdx] : null;
  const hoveredPoint = hoverIdx !== null ? points[hoverIdx] : null;

  // Tooltip: pin near the point, clamped so it stays inside the viewport.
  // Convert svg-space x back to a percent of the container.
  const tipPct = hovered ? (hovered.x / w) * 100 : 0;
  const tipTransform =
    tipPct < 12
      ? "translate(0%, -100%)"
      : tipPct > 88
        ? "translate(-100%, -100%)"
        : "translate(-50%, -100%)";

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h + 20}`}
        className="block w-full h-auto"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIdx(null)}
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
        {hovered && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={0}
              y2={h + 20}
              stroke="rgba(242,243,245,.25)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r={4}
              fill={stroke}
              stroke="#0f1113"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      {hoveredPoint && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-black/85 px-2.5 py-1.5 shadow-lg whitespace-nowrap"
          style={{
            left: `${tipPct}%`,
            top: hovered ? `${(hovered.y / (h + 20)) * 100}%` : 0,
            transform: tipTransform,
            marginTop: "-8px",
          }}
        >
          <div className="font-medium text-[10px] leading-none uppercase tracking-wider2 text-ink-faint">
            {formatShortMonthDay(hoveredPoint.date)}
          </div>
          <div className="font-semibold text-[12.5px] leading-none tabular text-ink mt-1">
            {formatCurrency(hoveredPoint.value)}
          </div>
        </div>
      )}
    </div>
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const defaultCenter = centerValueText ?? formatCurrency(total, { max: 0 });
  const hovered = hoverIdx !== null ? buckets[hoverIdx] : null;
  const hoveredPct =
    hovered && total > 0 ? (hovered.value / total) * 100 : 0;

  const centerLabelText = hovered ? hovered.label.toUpperCase() : centerLabel;
  const centerText = hovered
    ? formatCurrency(hovered.value, { max: 0 })
    : defaultCenter;

  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <g
          transform={`rotate(-90 ${cx} ${cy})`}
          fill="none"
          strokeLinecap="round"
        >
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
            const isHovered = hoverIdx === i;
            const dimmed = hoverIdx !== null && !isHovered;
            const el = (
              <circle
                key={b.key}
                cx={cx}
                cy={cy}
                r={r}
                stroke={colors[i % colors.length]}
                strokeWidth={isHovered ? 13 : 11}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                opacity={dimmed ? 0.35 : 1}
                style={{
                  transition: "opacity 120ms, stroke-width 120ms",
                  cursor: "pointer",
                }}
                pointerEvents="stroke"
                onPointerEnter={() => setHoverIdx(i)}
              />
            );
            offset += dash;
            return el;
          })}
        </g>
        {centerLabelText && (
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="rgba(242,243,245,.55)"
            style={{ font: "500 9.5px Archivo", letterSpacing: "0.14em" }}
          >
            {centerLabelText}
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
        {hovered && (
          <text
            x={cx}
            y={cy + 30}
            textAnchor="middle"
            fill="rgba(242,243,245,.55)"
            style={{ font: "500 10px Archivo" }}
          >
            {hoveredPct.toFixed(1)}%
          </text>
        )}
      </svg>
    </div>
  );
}
