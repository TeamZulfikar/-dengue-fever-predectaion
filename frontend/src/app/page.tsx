"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  ChevronRight,
  Map as MapIcon,
  MapPin,
  Printer,
  Search,
  ShieldCheck,
  Table2,
} from "lucide-react";
import DistrictExplorer from "@/components/DistrictExplorer";
import ModelIntelligence from "@/components/ModelIntelligence";
import TimeseriesChart from "@/components/TimeseriesChart";
import WhatIfSimulator from "@/components/WhatIfSimulator";
import {
  fetchDistrictPrediction,
  fetchDivision,
  loadInitialDashboardData,
} from "@/lib/api";
import type {
  DistrictPrediction,
  DistrictSummary,
  DivisionDetail,
  RiskLevel,
  SummaryResponse,
  TimeseriesPoint,
  Top10Item,
} from "@/types/dengue";

const BangladeshMap = dynamic(() => import("@/components/BangladeshMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[380px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-sm text-slate-400 sm:h-[440px]">
      ম্যাপ লোড হচ্ছে...
    </div>
  ),
});

const RISK_BADGE: Record<RiskLevel, { bn: string; en: string; cls: string }> = {
  high: {
    bn: "বেশি ঝুঁকি",
    en: "High Risk",
    cls: "bg-red-500/20 text-red-300 border-red-500/40",
  },
  medium: {
    bn: "মাঝারি ঝুঁকি",
    en: "Medium Risk",
    cls: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  },
  low: {
    bn: "কম ঝুঁকি",
    en: "Low Risk",
    cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
};

const RISK_DOT: Record<RiskLevel, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

type ActiveTab = "map" | "explorer" | "model";

export default function HomePage() {
  const [lang, setLang] = useState<"bn" | "en">("bn");
  const [activeTab, setActiveTab] = useState<ActiveTab>("map");
  const [loading, setLoading] = useState(true);
  const [isLiveApi, setIsLiveApi] = useState(false);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [districts, setDistricts] = useState<DistrictSummary[]>([]);
  const [top10, setTop10] = useState<Top10Item[]>([]);

  const [selectedDivision, setSelectedDivision] = useState<string | null>(null);
  const [divisionDetail, setDivisionDetail] = useState<DivisionDetail | null>(
    null
  );
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [districtPred, setDistrictPred] = useState<DistrictPrediction | null>(
    null
  );
  const [districtTs, setDistrictTs] = useState<TimeseriesPoint[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadInitialDashboardData()
      .then((res) => {
        setSummary(res.summary);
        setDistricts(res.districts);
        setTop10(res.top10);
        setIsLiveApi(res.isLiveApi);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectDivision(div: string) {
    setActiveTab("map");
    setSelectedDivision(div);
    setSelectedDistrict(null);
    setDistrictPred(null);
    const detail = await fetchDivision(div);
    setDivisionDetail(detail);
  }

  async function handleSelectDistrict(districtName: string) {
    setActiveTab("map");
    const found = districts.find(
      (d) => d.district.toLowerCase() === districtName.toLowerCase()
    );
    if (found && found.division !== selectedDivision) {
      setSelectedDivision(found.division);
      const detail = await fetchDivision(found.division);
      setDivisionDetail(detail);
    }
    setSelectedDistrict(found ? found.district : districtName);
    setSearchQuery("");
    const res = await fetchDistrictPrediction(
      found ? found.district : districtName
    );
    setDistrictPred(res.prediction);
    setDistrictTs(res.timeseries);
  }

  function resetToNational() {
    setSelectedDivision(null);
    setDivisionDetail(null);
    setSelectedDistrict(null);
    setDistrictPred(null);
    setDistrictTs([]);
  }

  const divisionsStats = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        bn: string;
        count: number;
        predSum: number;
        obsSum: number;
        high: number;
        medium: number;
        low: number;
      }
    >();
    for (const d of districts) {
      const cur = map.get(d.division) ?? {
        name: d.division,
        bn: d.division_bn,
        count: 0,
        predSum: 0,
        obsSum: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      cur.count += 1;
      cur.predSum += d.pred_blend;
      cur.obsSum += d.actual_cases ?? 0;
      cur[d.risk_level] += 1;
      map.set(d.division, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.predSum - a.predSum);
  }, [districts]);

  const highRiskCount = useMemo(
    () => districts.filter((d) => d.risk_level === "high").length,
    [districts]
  );

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return districts
      .filter(
        (d) =>
          d.district.toLowerCase().includes(q) ||
          d.division.toLowerCase().includes(q) ||
          d.division_bn.includes(q)
      )
      .slice(0, 8);
  }, [districts, searchQuery]);

  if (loading || !summary) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Activity className="h-4 w-4 animate-pulse text-sky-400" />
          <span>ড্যাশবোর্ড লোড হচ্ছে...</span>
        </div>
      </main>
    );
  }

  const tickerText = `Last observed week: ${summary.latest_observed_week} (আসল কেস ${Math.round(
    summary.national_actual_latest_week
  ).toLocaleString()}) | Forecast week: ${summary.latest_week} (built from data up to ${
    summary.latest_observed_week
  }): ${Math.round(
    summary.national_pred_next_week
  ).toLocaleString()} | শীর্ষ ৩ ঝুঁকিপূর্ণ জেলা: ${top10
    .slice(0, 3)
    .map((t) => `${t.district} (${t.pred_blend})`)
    .join(", ")} | মডেল MAE ${summary.model_metrics.blend_mae} বনাম Mean-3yr ${
    summary.model_metrics.mean3yr_mae
  } (${summary.model_metrics.beats_mean3yr_districts}/64 জেলায় জয়)`;

  return (
    <div className="min-h-screen text-slate-100">
      {/* Live Ticker Bar */}
      <div className="no-print overflow-hidden border-b border-sky-500/20 bg-sky-950/40 py-1.5 text-xs text-sky-200">
        <div className="animate-ticker whitespace-nowrap">
          <span className="mx-8">{tickerText}</span>
          <span className="mx-8">{tickerText}</span>
        </div>
      </div>

      {/* Header */}
      <header className="no-print sticky top-0 z-40 border-b border-slate-800/80 bg-[#060b16]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/15">
              <Activity className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">
                {lang === "bn"
                  ? "ডেঙ্গু পূর্বাভাস — ৬৪ জেলা"
                  : "Dengue Outbreak Forecasting — 64 Districts"}
              </h1>
              <p className="text-[11px] text-slate-400">
                {lang === "bn"
                  ? `Last observed week: ${summary.latest_observed_week} • ১ সপ্তাহ আগের পূর্বাভাস (Blend)`
                  : `Last observed week: ${summary.latest_observed_week} • 1-week-ahead Blend Forecast`}
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("map")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "map"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              {lang === "bn" ? "ম্যাপ ও পূর্বাভাস" : "Map & Forecast"}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("explorer")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "explorer"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              {lang === "bn" ? "৬৪ জেলার তুলনা" : "64 Districts"}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("model")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "model"
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Award className="h-3.5 w-3.5" />
              {lang === "bn" ? "মডেল ও সততা" : "Model & Caveats"}
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                isLiveApi
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-sky-500/40 bg-sky-500/15 text-sky-300"
              }`}
            >
              {isLiveApi
                ? "● Demo API"
                : lang === "bn"
                  ? "● অফলাইন স্ন্যাপশট"
                  : "● Offline Snapshot"}
            </span>
            <button
              type="button"
              onClick={() => setLang((l) => (l === "bn" ? "en" : "bn"))}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
            >
              {lang === "bn" ? "EN" : "বাংলা"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {/* Hero KPI Strip */}
        <section className="no-print grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur">
            <p className="text-xs text-slate-400">
              {lang === "bn"
                ? "আগামী ১ সপ্তাহে সারাদেশে পূর্বাভাস"
                : "Next-week National Forecast"}
            </p>
            <p className="mt-1.5 text-2xl font-bold text-sky-400 tabular-nums">
              {Math.round(summary.national_pred_next_week).toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {`Forecast week: ${summary.latest_week} (built from data up to ${summary.latest_observed_week})`}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur">
            <p className="text-xs text-slate-400">
              {lang === "bn"
                ? "সর্বশেষ সপ্তাহের আসল কেস (Observed)"
                : "Latest Observed Weekly Cases"}
            </p>
            <p className="mt-1.5 text-2xl font-bold text-white tabular-nums">
              {Math.round(summary.national_actual_latest_week).toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {`Last observed week: ${summary.latest_observed_week}`}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur">
            <p className="text-xs text-slate-400">
              {lang === "bn"
                ? "মডেল নির্ভুলতা (২০২৫ Held-out)"
                : "Model Accuracy (2025 Held-out)"}
            </p>
            <p className="mt-1.5 text-2xl font-bold text-emerald-400 tabular-nums">
              MAE {summary.model_metrics.blend_mae}{" "}
              <span className="text-sm font-normal text-slate-400">
                vs {summary.model_metrics.mean3yr_mae}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {lang === "bn"
                ? `${summary.model_metrics.mae_reduction_pct}% কম ভুল (${summary.model_metrics.beats_mean3yr_districts}/64 জেলায় জয়)`
                : `${summary.model_metrics.mae_reduction_pct}% lower MAE (${summary.model_metrics.beats_mean3yr_districts}/64 districts)`}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur">
            <p className="text-xs text-slate-400">
              {lang === "bn"
                ? "উচ্চ ঝুঁকিপূর্ণ জেলা (≥১০০ কেস)"
                : "High-Risk Districts (≥100 cases)"}
            </p>
            <p className="mt-1.5 text-2xl font-bold text-rose-400 tabular-nums">
              {highRiskCount}{" "}
              <span className="text-sm font-normal text-slate-400">/ 64</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {top10[0]
                ? `${lang === "bn" ? "শীর্ষে" : "Top"}: ${top10[0].district} (${top10[0].pred_blend})`
                : ""}
            </p>
          </div>
        </section>

        {activeTab === "explorer" ? (
          <DistrictExplorer
            districts={districts}
            lang={lang}
            onSelectDistrict={handleSelectDistrict}
          />
        ) : activeTab === "model" ? (
          <ModelIntelligence summary={summary} lang={lang} />
        ) : (
          <>
            {/* Search + Breadcrumb */}
            <section className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-300">
                <button
                  type="button"
                  onClick={resetToNational}
                  className={`rounded-lg px-2.5 py-1 transition hover:bg-slate-800 ${
                    !selectedDivision
                      ? "bg-sky-500/15 font-semibold text-sky-300"
                      : ""
                  }`}
                >
                  {lang === "bn" ? "বাংলাদেশ" : "Bangladesh"}
                </button>
                {selectedDivision && (
                  <>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                    <button
                      type="button"
                      onClick={() => handleSelectDivision(selectedDivision)}
                      className={`rounded-lg px-2.5 py-1 transition hover:bg-slate-800 ${
                        !selectedDistrict
                          ? "bg-sky-500/15 font-semibold text-sky-300"
                          : ""
                      }`}
                    >
                      {selectedDivision}
                    </button>
                  </>
                )}
                {selectedDistrict && (
                  <>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                    <span className="rounded-lg bg-sky-500/20 px-2.5 py-1 font-semibold text-sky-300">
                      {selectedDistrict}
                    </span>
                  </>
                )}
              </nav>

              <div className="relative w-full sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    lang === "bn"
                      ? "যেকোনো জেলা খুঁজুন (Dhaka, Cumilla)..."
                      : "Search district (Dhaka, Cumilla)..."
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/90 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-400 focus:border-sky-400 focus:outline-none"
                />
                {searchMatches.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                    {searchMatches.map((m) => (
                      <button
                        key={m.district}
                        type="button"
                        onClick={() => handleSelectDistrict(m.district)}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs transition hover:bg-slate-800"
                      >
                        <span>
                          <strong className="text-white">{m.district}</strong>{" "}
                          <span className="text-slate-400">
                            ({m.division_bn})
                          </span>
                        </span>
                        <span className="font-semibold text-sky-300 tabular-nums">
                          {m.pred_blend}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Map + Drill-down Panel */}
            <section className="grid gap-6 lg:grid-cols-12">
              <div className="no-print space-y-4 lg:col-span-6">
                <BangladeshMap
                  districts={districts}
                  selectedDivision={selectedDivision}
                  selectedDistrict={selectedDistrict}
                  onSelectDivision={handleSelectDivision}
                  onSelectDistrict={handleSelectDistrict}
                  onResetView={resetToNational}
                />

                {/* 8 Division Summary Cards */}
                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-300">
                      {lang === "bn"
                        ? "৮ বিভাগের সারসংক্ষেপ (ক্লিক করে ড্রিল-ডাউন করুন)"
                        : "8 Divisions Overview (Click to drill-down)"}
                    </p>
                    {selectedDivision && (
                      <button
                        type="button"
                        onClick={resetToNational}
                        className="text-[11px] text-sky-400 hover:underline"
                      >
                        {lang === "bn" ? "সব বিভাগ দেখুন" : "Reset"}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {divisionsStats.map((div) => {
                      const active = selectedDivision === div.name;
                      return (
                        <button
                          key={div.name}
                          type="button"
                          onClick={() => handleSelectDivision(div.name)}
                          className={`rounded-xl border p-2.5 text-left transition ${
                            active
                              ? "border-sky-400 bg-sky-500/15"
                              : "border-slate-800 bg-slate-950/60 hover:border-slate-600"
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-white truncate">
                              {lang === "bn" ? div.bn : div.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {div.count}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-bold text-sky-400 tabular-nums">
                            {Math.round(div.predSum)}
                          </p>
                          <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-slate-800">
                            {div.high > 0 && (
                              <div
                                className="bg-red-500"
                                style={{ width: `${(div.high / div.count) * 100}%` }}
                              />
                            )}
                            {div.medium > 0 && (
                              <div
                                className="bg-amber-500"
                                style={{
                                  width: `${(div.medium / div.count) * 100}%`,
                                }}
                              />
                            )}
                            {div.low > 0 && (
                              <div
                                className="bg-emerald-500"
                                style={{ width: `${(div.low / div.count) * 100}%` }}
                              />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-4 lg:col-span-6">
                {districtPred ? (
                  <div className="space-y-4">
                    <div className="print-card rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-sky-400" />
                            <h2 className="text-xl font-bold text-white">
                              {districtPred.district}{" "}
                              <span className="text-sm font-normal text-slate-400">
                                ({districtPred.division_bn})
                              </span>
                            </h2>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {`Forecast week: ${districtPred.week_start} (built from data up to ${
                              districtPred.actual_week ?? summary.latest_observed_week
                            })`}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              RISK_BADGE[districtPred.risk_level].cls
                            }`}
                          >
                            {lang === "bn"
                              ? RISK_BADGE[districtPred.risk_level].bn
                              : RISK_BADGE[districtPred.risk_level].en}
                          </span>
                          <button
                            type="button"
                            onClick={() => window.print()}
                            className="no-print flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-700"
                            title="Print / Save 1-Page PDF Report"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>PDF</span>
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-[11px] text-slate-400">
                            {lang === "bn"
                              ? "পূর্বাভাস (Blend)"
                              : "Forecast (Blend)"}
                          </p>
                          <p className="mt-1 text-2xl font-bold text-sky-400 tabular-nums">
                            {districtPred.pred_blend}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-[11px] text-slate-400">
                            {lang === "bn" ? "সর্বশেষ আসল" : "Latest Observed"}
                          </p>
                          <p className="mt-1 text-2xl font-bold text-white tabular-nums">
                            {districtPred.actual_cases ?? "—"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-[11px] text-slate-400">
                            GBM / Persist
                          </p>
                          <p className="mt-1 text-base font-semibold text-slate-200 tabular-nums">
                            {districtPred.pred_gbm} /{" "}
                            {districtPred.pred_persist}
                          </p>
                        </div>
                      </div>

                      {/* 50/50 Blend Split Bar */}
                      <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
                        <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-slate-300">
                          <span>GBM-log (+transfer): 50%</span>
                          <span>Persistence: 50% (weights fixed in advance)</span>
                        </div>
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className="w-1/2 bg-sky-400" />
                          <div className="w-1/2 bg-emerald-400" />
                        </div>
                      </div>

                      {/* Explainability Bars */}
                      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                        <h3 className="text-xs font-semibold text-slate-200">
                          {lang === "bn"
                            ? "কেন এই পূর্বাভাস? (মডেলের ব্যাখ্যা)"
                            : "Why this forecast? (Model breakdown)"}
                        </h3>
                        <div className="mt-2.5 space-y-2">
                          {districtPred.reasons.map((r, idx) => {
                            const maxImp = Math.max(
                              1,
                              ...districtPred.reasons.map((x) => x.impact)
                            );
                            const barPct =
                              r.impact > 0
                                ? Math.max(8, (r.impact / maxImp) * 100)
                                : 0;
                            return (
                              <div key={idx} className="space-y-1 text-xs">
                                <div className="flex items-center justify-between gap-2 text-slate-300">
                                  <span>{r.label}</span>
                                  {r.impact > 0 && (
                                    <span className="font-mono font-semibold text-sky-300">
                                      +{r.impact}
                                    </span>
                                  )}
                                </div>
                                {r.impact > 0 && (
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                    <div
                                      className="h-full rounded-full bg-sky-400"
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Precautions */}
                      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                        <h3 className="text-xs font-semibold text-slate-200">
                          {lang === "bn" ? "সতর্কতা ও করণীয়" : "Precautions"}
                        </h3>
                        <ul className="mt-1.5 space-y-1 text-xs text-slate-300">
                          {districtPred.actions.map((a, idx) => (
                            <li key={idx}>• {a}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <TimeseriesChart
                      points={districtTs}
                      title={
                        lang === "bn"
                          ? `${districtPred.district} — ২০২৫ আসল বনাম পূর্বাভাস`
                          : `${districtPred.district} — 2025 Actual vs Forecast`
                      }
                    />

                    <div className="no-print">
                      <WhatIfSimulator
                        district={districtPred.district}
                        initialCases={districtPred.actual_cases ?? 20}
                        isLiveApi={isLiveApi}
                      />
                    </div>
                  </div>
                ) : divisionDetail ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h2 className="text-lg font-bold text-white">
                            {lang === "bn"
                              ? `${divisionDetail.division_bn} বিভাগ`
                              : `${divisionDetail.division} Division`}
                          </h2>
                          <p className="text-xs text-slate-400">
                            {lang === "bn"
                              ? "বিভাগের মোট = তার জেলাগুলোর যোগফল"
                              : "Division total = exact sum of districts"}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            RISK_BADGE[divisionDetail.risk_level].cls
                          }`}
                        >
                          {lang === "bn"
                            ? RISK_BADGE[divisionDetail.risk_level].bn
                            : RISK_BADGE[divisionDetail.risk_level].en}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs text-slate-400">
                            {lang === "bn"
                              ? "বিভাগের পূর্বাভাস"
                              : "Division Forecast"}
                          </p>
                          <p className="mt-1 text-2xl font-bold text-sky-400 tabular-nums">
                            {divisionDetail.pred_total}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                          <p className="text-xs text-slate-400">
                            {lang === "bn" ? "সর্বশেষ আসল" : "Latest Observed"}
                          </p>
                          <p className="mt-1 text-2xl font-bold text-white tabular-nums">
                            {divisionDetail.actual_total}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-xs font-semibold text-slate-300">
                          {lang === "bn"
                            ? "জেলা বেছে নিন:"
                            : "Select a district:"}
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {divisionDetail.districts.map((d) => (
                            <button
                              key={d.district}
                              type="button"
                              onClick={() => handleSelectDistrict(d.district)}
                              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-left text-xs transition hover:border-sky-400"
                            >
                              <span className="flex items-center gap-1.5 truncate">
                                <span
                                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                                    RISK_DOT[d.risk_level]
                                  }`}
                                />
                                <span className="truncate font-medium text-slate-100">
                                  {d.district}
                                </span>
                              </span>
                              <span className="ml-1 font-bold text-sky-300 tabular-nums">
                                {d.pred_blend}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <TimeseriesChart
                      points={divisionDetail.timeseries}
                      title={
                        lang === "bn"
                          ? `${divisionDetail.division_bn} বিভাগ — ২০২৫ আসল বনাম পূর্বাভাস`
                          : `${divisionDetail.division} Division — 2025 Actual vs Forecast`
                      }
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 backdrop-blur">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-bold text-white">
                          {lang === "bn"
                            ? "আগামী সপ্তাহে সবচেয়ে ঝুঁকিপূর্ণ ১০ জেলা"
                            : "Top 10 High-Risk Districts"}
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {lang === "bn"
                            ? "জেলায় ক্লিক করে বিস্তারিত, চার্ট ও সিমুলেটর দেখুন"
                            : "Click any district to view forecast, chart & simulator"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab("explorer")}
                        className="text-xs font-medium text-sky-400 hover:underline"
                      >
                        {lang === "bn" ? "সব ৬৪ জেলা →" : "All 64 →"}
                      </button>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {top10.map((item) => {
                        const maxTop = Math.max(1, top10[0]?.pred_blend ?? 1);
                        const barW = Math.max(6, (item.pred_blend / maxTop) * 100);
                        return (
                          <button
                            key={item.district}
                            type="button"
                            onClick={() => handleSelectDistrict(item.district)}
                            className="w-full rounded-xl border border-slate-800/60 bg-slate-950/50 px-3 py-2 text-left transition hover:border-sky-500/50 hover:bg-slate-800/40"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="w-5 font-semibold text-slate-500 tabular-nums">
                                  #{item.rank}
                                </span>
                                <span
                                  className={`inline-block h-2 w-2 rounded-full ${
                                    RISK_DOT[item.risk_level]
                                  }`}
                                />
                                <span className="font-semibold text-white">
                                  {item.district}
                                </span>
                                <span className="text-slate-400">
                                  ({lang === "bn" ? item.division_bn : item.division})
                                </span>
                              </div>
                              <div className="tabular-nums">
                                <span className="font-bold text-sky-400">
                                  {item.pred_blend}
                                </span>
                                <span className="ml-2 text-slate-400">
                                  ({lang === "bn" ? "আসল" : "obs"}:{" "}
                                  {item.actual_cases ?? "—"})
                                </span>
                              </div>
                            </div>
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-rose-400"
                                style={{ width: `${barW}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {/* Compact Honesty Footer */}
        <footer className="no-print rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 text-xs text-slate-400">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-200">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              সব টার্গেট Figshare/DGHS আসল ডেটা (অনুমান-করা কেস নয়) • শুধু ১
              সপ্তাহের পূর্বাভাস
            </span>
            <span className="flex items-center gap-1 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Blend MAE {summary.model_metrics.blend_mae} vs Mean-3yr{" "}
              {summary.model_metrics.mean3yr_mae} (৬৩/৬৪ জেলায় জয়, নারায়ণগঞ্জে হারে)
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
