export type RiskLevel = "high" | "medium" | "low";

export interface DistrictSummary {
  district: string;
  division: string;
  division_bn: string;
  lat: number;
  lon: number;
  week_start: string;
  actual_cases: number | null;
  actual_week: string | null;
  pred_blend: number;
  risk_level: RiskLevel;
}

export interface ReasonItem {
  label: string;
  impact: number;
}

export interface DistrictPrediction {
  district: string;
  division: string;
  division_bn: string;
  week_start: string;
  actual_cases: number | null;
  actual_week: string | null;
  pred_blend: number;
  pred_gbm: number;
  pred_persist: number;
  risk_level: RiskLevel;
  reasons: ReasonItem[];
  actions: string[];
  is_observed_target: boolean;
  horizon_weeks: number;
}

export interface DivisionDetail {
  division: string;
  division_bn: string;
  week_start: string;
  actual_total: number;
  pred_total: number;
  risk_level: RiskLevel;
  districts: {
    district: string;
    actual_cases: number | null;
    pred_blend: number;
    risk_level: RiskLevel;
  }[];
  timeseries: {
    week_start: string;
    actual: number | null;
    pred_blend: number | null;
  }[];
}

export interface Top10Item {
  rank: number;
  district: string;
  division: string;
  division_bn: string;
  week_start: string;
  actual_cases: number | null;
  pred_blend: number;
  risk_level: RiskLevel;
}

export interface TimeseriesPoint {
  week_start: string;
  actual: number | null;
  pred_blend: number | null;
  pred_gbm?: number | null;
  pred_persist?: number | null;
}

export interface SummaryResponse {
  latest_week: string;
  latest_observed_week: string;
  national_actual_latest_week: number;
  national_pred_next_week: number;
  model_metrics: {
    best_model: string;
    blend_mae: number;
    mean3yr_mae: number;
    mae_reduction_pct: number;
    beats_mean3yr_districts: number;
    total_districts: number;
    test_actual_annual_2025: number;
    test_pred_annual_2025: number;
  };
  caveats: string[];
  benchmarks?: Record<
    string,
    {
      MAE: number;
      RMSE: number;
      MAPE_pos: number;
      R2: number;
      annual_pred: number;
      annual_err_pct: number;
    }
  >;
  horizon_note: string;
}

export interface OfflineSnapshot {
  summary: SummaryResponse;
  districts: DistrictSummary[];
  top10: Top10Item[];
  divisions: Record<string, DivisionDetail>;
  predictions: Record<string, DistrictPrediction>;
  timeseries: Record<string, { district: string; split: string; points: TimeseriesPoint[] }>;
}

export interface WhatIfResponse {
  district: string;
  inputs: {
    cases_last_week: number;
    rain_mm_3w_ago: number;
  };
  pred_gbm: number;
  pred_persist: number;
  pred_blend: number;
  risk_level: RiskLevel;
  note: string;
}
