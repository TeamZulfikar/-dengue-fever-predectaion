"use client";

import { useEffect, useState } from "react";
import { Sliders } from "lucide-react";
import { runWhatIfSimulation } from "@/lib/api";
import type { WhatIfResponse } from "@/types/dengue";

interface WhatIfSimulatorProps {
  district: string;
  initialCases: number;
  isLiveApi: boolean;
}

export default function WhatIfSimulator({
  district,
  initialCases,
  isLiveApi,
}: WhatIfSimulatorProps) {
  const maxCases = Math.max(600, Math.ceil((initialCases * 2) / 50) * 50);
  const [casesLastWeek, setCasesLastWeek] = useState<number>(
    Math.round(initialCases)
  );
  const [rainMm, setRainMm] = useState<number>(60);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCasesLastWeek(Math.round(initialCases));
    setResult(null);
    setError(null);
  }, [district, initialCases]);

  async function handleSimulate() {
    setLoading(true);
    setError(null);
    try {
      const res = await runWhatIfSimulation(district, casesLastWeek, rainMm);
      setResult(res);
    } catch {
      setError(
        "লাইভ FastAPI সার্ভার চালু নেই — অফলাইন মোডে সিমুলেটর চলে না।"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            What-if সিমুলেটর ({district})
          </h3>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            isLiveApi
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          সেন্সিটিভিটি সিমুলেশন — আসল মডেল চালায় না, প্রি-কম্পিউটেড পূর্বাভাসের ওপর অনুমান করে
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-slate-300">
          <div className="mb-1 flex justify-between">
            <span>গত সপ্তাহের কেস</span>
            <strong className="text-slate-100">{casesLastWeek}</strong>
          </div>
          <input
            type="range"
            min={0}
            max={maxCases}
            step={5}
            value={casesLastWeek}
            onChange={(e) => setCasesLastWeek(Number(e.target.value))}
            className="w-full accent-sky-400"
          />
        </label>

        <label className="block text-xs text-slate-300">
          <div className="mb-1 flex justify-between">
            <span>৩ সপ্তাহ আগের বৃষ্টি (mm)</span>
            <strong className="text-slate-100">{rainMm} mm</strong>
          </div>
          <input
            type="range"
            min={0}
            max={300}
            step={5}
            value={rainMm}
            onChange={(e) => setRainMm(Number(e.target.value))}
            className="w-full accent-sky-400"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSimulate}
          disabled={loading}
          className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
        >
          {loading ? "হিসাব হচ্ছে..." : "নতুন পূর্বাভাস দেখুন"}
        </button>

        {result && (
          <div className="text-xs text-slate-200">
            নতুন Blend পূর্বাভাস:{" "}
            <strong className="text-sky-300">{result.pred_blend}</strong>{" "}
            (GBM: {result.pred_gbm}, Persistence: {result.pred_persist})
          </div>
        )}
        {error && <div className="text-xs text-amber-300">{error}</div>}
      </div>
    </div>
  );
}
