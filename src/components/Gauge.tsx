"use client";

/**
 * The dial. Linear from 1x to 6x and clamped, with the band boundaries drawn
 * on the face so the colour of the reading is legible as a position rather
 * than as a mood — you can see *why* a needle is amber.
 */
const MIN = 1;
const MAX = 6;

function angleFor(ratio: number) {
  const t = Math.min(1, Math.max(0, (ratio - MIN) / (MAX - MIN)));
  return -90 + t * 180;
}

function arc(from: number, to: number, r: number) {
  const a = (d: number) => ((d - 90) * Math.PI) / 180;
  const x1 = 100 + r * Math.cos(a(from + 90));
  const y1 = 100 + r * Math.sin(a(from + 90));
  const x2 = 100 + r * Math.cos(a(to + 90));
  const y2 = 100 + r * Math.sin(a(to + 90));
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function Gauge({ ratio, live }: { ratio: number | null; live: boolean }) {
  const angle = ratio === null ? -90 : angleFor(ratio);
  const bands: [number, number, string][] = [
    [MIN, 1.5, "var(--level)"],
    [1.5, 3, "var(--down)"],
    [3, MAX, "var(--bad)"],
  ];

  return (
    <svg viewBox="0 0 200 118" className="w-full max-w-[320px]" role="img"
      aria-label={ratio === null ? "No reading yet" : `${ratio.toFixed(2)} times slower`}>
      {/* face */}
      <path d={arc(angleFor(MIN), angleFor(MAX), 80)} fill="none" stroke="var(--line)" strokeWidth="10" strokeLinecap="butt" />
      {bands.map(([a, b, c]) => (
        <path key={a} d={arc(angleFor(a), angleFor(b), 80)} fill="none" stroke={c} strokeWidth="10"
          opacity={ratio === null ? 0.18 : ratio >= a ? 0.95 : 0.18} />
      ))}

      {/* ticks */}
      {[1, 2, 3, 4, 5, 6].map((v) => {
        const d = angleFor(v);
        const rad = ((d - 90) * Math.PI) / 180;
        const inner = 68, outer = 72;
        return (
          <g key={v}>
            <line
              x1={100 + inner * Math.cos(rad)} y1={100 + inner * Math.sin(rad)}
              x2={100 + outer * Math.cos(rad)} y2={100 + outer * Math.sin(rad)}
              stroke="var(--ink-dim)" strokeWidth="1.5"
            />
            <text
              x={100 + 58 * Math.cos(rad)} y={100 + 58 * Math.sin(rad)}
              fill="var(--ink-dim)" fontSize="9" textAnchor="middle" dominantBaseline="central"
              fontFamily="ui-monospace, monospace"
            >
              {v}
            </text>
          </g>
        );
      })}

      {/* needle */}
      <g className={live ? "needle running" : "needle"} style={{ transform: `rotate(${angle}deg)` }}>
        <line x1="100" y1="100" x2="100" y2="26" stroke={ratio === null ? "var(--ink-dim)" : "var(--gap)"} strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <circle cx="100" cy="100" r="5" fill="var(--panel)" stroke="var(--ink-dim)" strokeWidth="1.5" />
    </svg>
  );
}
