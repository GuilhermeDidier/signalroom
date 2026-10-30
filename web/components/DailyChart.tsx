"use client";

import { useWidth } from "@/lib/use-width";

interface Day {
  day: string;
  conversations: number;
  escalated: number;
}

const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 34 };

function niceMax(v: number) {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => v / s <= 4) ?? pow * 10;
  return Math.ceil(v / step) * step;
}

/** Stacked daily bars: AI-resolved (steel) under escalated (red). */
export function DailyChart({ daily }: { daily: Day[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = niceMax(Math.max(1, ...daily.map((d) => d.conversations)));
  const innerW = Math.max(100, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, daily.length);
  const barW = Math.max(4, Math.min(28, slot * 0.62));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = slot < 34 ? Math.ceil(34 / slot) : 1;
  const total = daily.reduce((s, d) => s + d.conversations, 0);
  const esc = daily.reduce((s, d) => s + d.escalated, 0);

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={H} role="img" aria-label={`Daily conversations over ${daily.length} days: ${total - esc} resolved by AI, ${esc} escalated.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "chart__base" : "chart__grid"} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart__tick">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const resolved = d.conversations - d.escalated;
          const date = new Date(`${d.day}T00:00:00`);
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${resolved} AI-resolved, ${d.escalated} escalated`}</title>
              <rect x={x} y={y(resolved)} width={barW} height={y(0) - y(resolved)} rx="2" className="chart__ok" />
              <rect x={x} y={y(d.conversations)} width={barW} height={Math.max(0, y(resolved) - y(d.conversations) - 1.5)} rx="2" className="chart__esc" />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="chart__tick">
                  {date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).replace(" ", " ")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart__legend">
        <span><i className="sw sw--ok" /> AI-resolved</span>
        <span><i className="sw sw--esc" /> Escalated to a human</span>
      </div>
    </div>
  );
}
