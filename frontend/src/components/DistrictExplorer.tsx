"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import type { DistrictSummary, RiskLevel } from "@/types/dengue";

interface DistrictExplorerProps {
  districts: DistrictSummary[];
  lang: "bn" | "en";
  onSelectDistrict: (district: string) => void;
}

const RISK_LABEL: Record<RiskLevel, { bn: string; en: string; cls: string }> = {
  high: {
    bn: "বেশি ঝুঁকি",
    en: "High",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
  },
  medium: {
    bn: "মাঝারি",
    en: "Medium",
    cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  },
  low: {
    bn: "কম",
    en: "Low",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
};

export default function DistrictExplorer({
  districts,
  lang,
  onSelectDistrict,
}: DistrictExplorerProps) {
  const [query, setQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"pred" | "actual" | "name">("pred");

  const divisions = useMemo(
    () => Array.from(new Set(districts.map((d) => d.division))).sort(),
    [districts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return districts
      .filter((d) => {
        if (divisionFilter !== "all" && d.division !== divisionFilter) {
          return false;
        }
        if (riskFilter !== "all" && d.risk_level !== riskFilter) {
          return false;
        }
        if (
          q &&
          !d.district.toLowerCase().includes(q) &&
          !d.division.toLowerCase().includes(q) &&
          !d.division_bn.includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.district.localeCompare(b.district);
        if (sortBy === "actual") {
          return (b.actual_cases ?? 0) - (a.actual_cases ?? 0);
        }
        return b.pred_blend - a.pred_blend;
      });
  }, [districts, query, divisionFilter, riskFilter, sortBy]);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-white">
            {lang === "bn"
              ? `৬৪ জেলার পূর্ণ তালিকা ও তুলনা (${filtered.length}টি)`
              : `All 64 Districts Comparison (${filtered.length})`}
          </h2>
          <p className="text-xs text-slate-400">
            {lang === "bn"
              ? "যেকোনো জেলায় ক্লিক করলে ম্যাপ ও চার্টসহ বিস্তারিত খুলবে"
              : "Click any row to open full district forecast & 2025 chart"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lang === "bn" ? "জেলা খুঁজুন..." : "Filter district..."}
              className="rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder-slate-400 focus:border-sky-400 focus:outline-none"
            />
          </div>

          <select
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-400 focus:outline-none"
          >
            <option value="all">{lang === "bn" ? "সব বিভাগ" : "All Divisions"}</option>
            {divisions.map((div) => (
              <option key={div} value={div}>
                {div}
              </option>
            ))}
          </select>

          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-400 focus:outline-none"
          >
            <option value="all">{lang === "bn" ? "সব ঝুঁকি" : "All Risk"}</option>
            <option value="high">{lang === "bn" ? "বেশি ঝুঁকি" : "High"}</option>
            <option value="medium">{lang === "bn" ? "মাঝারি" : "Medium"}</option>
            <option value="low">{lang === "bn" ? "কম" : "Low"}</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "pred" | "actual" | "name")}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-sky-400 focus:outline-none"
          >
            <option value="pred">{lang === "bn" ? "সাজান: পূর্বাভাস" : "Sort: Forecast"}</option>
            <option value="actual">{lang === "bn" ? "সাজান: আসল কেস" : "Sort: Observed"}</option>
            <option value="name">{lang === "bn" ? "সাজান: নাম (A–Z)" : "Sort: Name"}</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2.5 pr-3 font-medium">#</th>
              <th className="py-2.5 pr-3 font-medium">
                {lang === "bn" ? "জেলা" : "District"}
              </th>
              <th className="py-2.5 pr-3 font-medium">
                {lang === "bn" ? "বিভাগ" : "Division"}
              </th>
              <th className="py-2.5 pr-3 text-right font-medium">
                {lang === "bn" ? "আসল (Observed)" : "Observed"}
              </th>
              <th className="py-2.5 pr-3 text-right font-medium">
                {lang === "bn" ? "পূর্বাভাস (১ সপ্তাহ)" : "1-Week Forecast"}
              </th>
              <th className="py-2.5 pr-3 text-right font-medium">
                {lang === "bn" ? "প্রবণতা" : "Trend"}
              </th>
              <th className="py-2.5 text-right font-medium">
                {lang === "bn" ? "ঝুঁকি" : "Risk"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filtered.map((d, idx) => {
              const actual = d.actual_cases ?? 0;
              const diff = d.pred_blend - actual;
              const up = diff >= 0;
              const badge = RISK_LABEL[d.risk_level];
              return (
                <tr
                  key={d.district}
                  onClick={() => onSelectDistrict(d.district)}
                  className="cursor-pointer transition hover:bg-slate-800/40"
                >
                  <td className="py-2.5 pr-3 text-slate-500 tabular-nums">{idx + 1}</td>
                  <td className="py-2.5 pr-3 font-semibold text-white">{d.district}</td>
                  <td className="py-2.5 pr-3 text-slate-400">
                    {lang === "bn" ? d.division_bn : d.division}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-slate-200 tabular-nums">
                    {d.actual_cases ?? "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-bold text-sky-400 tabular-nums">
                    {d.pred_blend}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    <span
                      className={`inline-flex items-center gap-0.5 ${
                        up ? "text-rose-300" : "text-emerald-300"
                      }`}
                    >
                      {up ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                      {diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
                    >
                      {lang === "bn" ? badge.bn : badge.en}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
