"use client";

import { AlertTriangle, Award, ShieldCheck } from "lucide-react";
import type { SummaryResponse } from "@/types/dengue";

interface ModelIntelligenceProps {
  summary: SummaryResponse;
  lang: "bn" | "en";
}

export default function ModelIntelligence({
  summary,
  lang,
}: ModelIntelligenceProps) {
  const benchmarks = summary.benchmarks ?? {};
  const orderedKeys = [
    "Blend GBM-log+persist",
    "Blend GBM-L1+persist",
    "Persistence",
    "GBM-log + transfer",
    "GBM-log (no transfer)",
    "Seasonal naive",
    "Mean-3yr",
  ].filter((k) => benchmarks[k]);

  const maxMae = Math.max(
    32,
    ...orderedKeys.map((k) => benchmarks[k]?.MAE ?? 0)
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4">
          <p className="text-xs text-slate-400">
            {lang === "bn" ? "সেরা মডেল MAE (২০২৫)" : "Best Model MAE (2025)"}
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-400 tabular-nums">
            {summary.model_metrics.blend_mae}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">R² = 0.957 (3,264 জেলা-সপ্তাহ)</p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4">
          <p className="text-xs text-slate-400">
            {lang === "bn" ? "Mean-3yr বেসলাইন MAE" : "Mean-3yr Baseline MAE"}
          </p>
          <p className="mt-1 text-2xl font-bold text-rose-400 tabular-nums">
            {summary.model_metrics.mean3yr_mae}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Blend {summary.model_metrics.mae_reduction_pct}% ভালো
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4">
          <p className="text-xs text-slate-400">
            {lang === "bn" ? "২০২৫ বাৎসরিক অনুমান" : "2025 Annual Prediction"}
          </p>
          <p className="mt-1 text-2xl font-bold text-sky-400 tabular-nums">
            {Math.round(summary.model_metrics.test_pred_annual_2025).toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            আসল: {Math.round(summary.model_metrics.test_actual_annual_2025).toLocaleString()} (+0.21%)
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4">
          <p className="text-xs text-slate-400">
            {lang === "bn" ? "জেলায় বেসলাইনকে হারিয়েছে" : "Districts Beating Baseline"}
          </p>
          <p className="mt-1 text-2xl font-bold text-white tabular-nums">
            {summary.model_metrics.beats_mean3yr_districts}/
            {summary.model_metrics.total_districts}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            শুধু নারায়ণগঞ্জে হারে
          </p>
        </div>
      </div>

      {/* Benchmark Comparison Bars */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Award className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-bold text-white">
            {lang === "bn"
              ? "২০২৫ Held-out টেস্ট সেটে সব মডেলের তুলনা (MAE যত কম, তত ভালো)"
              : "2025 Held-out Benchmark Comparison (Lower MAE is better)"}
          </h3>
        </div>

        <div className="space-y-3">
          {orderedKeys.map((name) => {
            const m = benchmarks[name];
            const pct = Math.max(4, (m.MAE / maxMae) * 100);
            const isBest = name === "Blend GBM-log+persist";
            return (
              <div key={name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={
                      isBest ? "font-bold text-sky-300" : "text-slate-300"
                    }
                  >
                    {name} {isBest ? "★ (Headline)" : ""}
                  </span>
                  <span className="text-slate-300 tabular-nums">
                    MAE <b>{m.MAE.toFixed(2)}</b> | R² {m.R2.toFixed(3)} | বাৎসরিক
                    ত্রুটি {m.annual_err_pct >= 0 ? "+" : ""}
                    {m.annual_err_pct.toFixed(2)}%
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isBest
                        ? "bg-gradient-to-r from-sky-400 to-emerald-400"
                        : name === "Mean-3yr"
                          ? "bg-rose-500/80"
                          : "bg-slate-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Honest Caveats */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-bold text-white">
            {lang === "bn"
              ? "মডেলের সৎ সীমাবদ্ধতা (metrics.json থেকে যাচাইকৃত)"
              : "Honest Model Caveats (from metrics.json)"}
          </h3>
        </div>
        <ul className="grid gap-2.5 text-xs text-slate-300 sm:grid-cols-2">
          {summary.caveats.map((c, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
