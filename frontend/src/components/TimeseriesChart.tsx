"use client";

import { useId, useMemo, useState } from "react";
import type { TimeseriesPoint } from "@/types/dengue";

interface TimeseriesChartProps {
  points: TimeseriesPoint[];
  title: string;
}

export default function TimeseriesChart({ points, title }: TimeseriesChartProps) {
  const gradId = useId().replace(/:/g, "");
  const [maxWeeks, setMaxWeeks] = useState<number>(52);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visible = useMemo(() => {
    const valid = points.filter(
      (p) => p.actual !== null || p.pred_blend !== null
    );
    return valid.slice(0, Math.min(maxWeeks, valid.length));
  }, [points, maxWeeks]);

  if (visible.length === 0) {
    return (
      <div className="print-card rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 text-sm text-slate-400">
        চার্টের ডেটা পাওয়া যায়নি।
      </div>
    );
  }

  const width = 680;
  const height = 250;
  const padL = 46;
  const padR = 16;
  const padT = 18;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxVal = Math.max(
    10,
    ...visible.flatMap((p) => [
      p.actual ?? 0,
      p.pred_blend ?? 0,
      p.pred_persist ?? 0,
    ])
  );

  const xFor = (i: number) =>
    visible.length <= 1 ? padL : padL + (i / (visible.length - 1)) * innerW;
  const yFor = (v: number) => padT + innerH - (v / maxVal) * innerH;

  const buildPath = (getter: (p: TimeseriesPoint) => number | null | undefined) => {
    let d = "";
    visible.forEach((p, i) => {
      const val = getter(p);
      if (val === null || val === undefined) return;
      const cmd = d === "" ? "M" : "L";
      d += `${cmd}${xFor(i).toFixed(1)},${yFor(val).toFixed(1)} `;
    });
    return d.trim();
  };

  const actualPath = buildPath((p) => p.actual);
  const blendPath = buildPath((p) => p.pred_blend);
  const persistPath = buildPath((p) => p.pred_persist);

  const blendPointsValid = visible
    .map((p, i) => ({ i, v: p.pred_blend }))
    .filter((x): x is { i: number; v: number } => x.v !== null && x.v !== undefined);
  const areaPath =
    blendPath && blendPointsValid.length > 1
      ? `${blendPath} L${xFor(blendPointsValid[blendPointsValid.length - 1].i).toFixed(1)},${(
          padT + innerH
        ).toFixed(1)} L${xFor(blendPointsValid[0].i).toFixed(1)},${(
          padT + innerH
        ).toFixed(1)} Z`
      : "";

  const hovered = hoverIdx !== null ? visible[hoverIdx] : null;
  const peakActual = Math.max(...visible.map((p) => p.actual ?? 0));

  return (
    <div className="print-card rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <p className="text-[11px] text-slate-400">
            সর্বোচ্চ সাপ্তাহিক আসল কেস: <b className="text-slate-200">{peakActual}</b>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-slate-100" />
            আসল (Observed)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-sky-400" />
            মডেল (Blend)
          </span>
          {persistPath && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 border-b border-dashed border-rose-400" />
              Persistence
            </span>
          )}
        </div>
      </div>

      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[320px]"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padT + innerH * (1 - t);
            const label = Math.round(maxVal * t);
            return (
              <g key={t}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke="#1e293b"
                  strokeWidth={1}
                />
                <text
                  x={padL - 6}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#94a3b8"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}

          {persistPath && (
            <path
              d={persistPath}
              fill="none"
              stroke="#fb7185"
              strokeWidth={1.3}
              strokeDasharray="4 4"
            />
          )}
          {actualPath && (
            <path d={actualPath} fill="none" stroke="#f8fafc" strokeWidth={2} />
          )}
          {blendPath && (
            <path d={blendPath} fill="none" stroke="#38bdf8" strokeWidth={2.4} />
          )}

          {visible.map((p, i) => (
            <rect
              key={p.week_start}
              x={xFor(i) - innerW / visible.length / 2}
              y={padT}
              width={Math.max(4, innerW / visible.length)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}

          {hoverIdx !== null && hovered && (
            <g>
              <line
                x1={xFor(hoverIdx)}
                y1={padT}
                x2={xFor(hoverIdx)}
                y2={padT + innerH}
                stroke="#475569"
                strokeDasharray="3 3"
              />
              {hovered.actual !== null && (
                <circle
                  cx={xFor(hoverIdx)}
                  cy={yFor(hovered.actual)}
                  r={4}
                  fill="#f8fafc"
                  stroke="#0f172a"
                  strokeWidth={1.5}
                />
              )}
              {hovered.pred_blend !== null && (
                <circle
                  cx={xFor(hoverIdx)}
                  cy={yFor(hovered.pred_blend)}
                  r={4.5}
                  fill="#38bdf8"
                  stroke="#0f172a"
                  strokeWidth={1.5}
                />
              )}
            </g>
          )}

          <text x={padL} y={height - 8} fontSize="10" fill="#94a3b8">
            {visible[0]?.week_start}
          </text>
          <text
            x={width - padR}
            y={height - 8}
            textAnchor="end"
            fontSize="10"
            fill="#94a3b8"
          >
            {visible[visible.length - 1]?.week_start}
          </text>
        </svg>
      </div>

      <div className="no-print mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
        <label className="flex items-center gap-2">
          <span>সপ্তাহ সীমা ({visible.length}):</span>
          <input
            type="range"
            min={8}
            max={Math.max(12, points.length)}
            value={maxWeeks}
            onChange={(e) => setMaxWeeks(Number(e.target.value))}
            className="accent-sky-400"
          />
        </label>
        {hovered ? (
          <div className="rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-slate-100 tabular-nums">
            {hovered.week_start} — আসল: <b>{hovered.actual ?? "—"}</b> | মডেল:{" "}
            <b className="text-sky-300">{hovered.pred_blend ?? "—"}</b>
          </div>
        ) : (
          <span className="text-slate-400">
            কার্সার রাখলে সপ্তাহের মান দেখাবে
          </span>
        )}
      </div>
    </div>
  );
}
