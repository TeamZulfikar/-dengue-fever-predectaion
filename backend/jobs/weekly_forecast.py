"""
weekly_forecast.py — Precomputes 1-week-ahead 50/50 Blend forecasts and TreeSHAP
explanations for all 64 districts and writes data/forecasts_latest.json and
data/shap_values.csv.

Blend weights (0.5 * GBM-log(+transfer) + 0.5 * persistence) are fixed in advance
and never modified here.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR.parent / "data"
sys.path.insert(0, str(BACKEND_DIR))

from jobs.build_weekly_panel import build_weekly_panel
from predict_blend import FEATS

assert len(FEATS) == 43, f"Expected 43 features in FEATS, got {len(FEATS)}"

MODEL_PATH = BACKEND_DIR / "model" / "gbm_transfer_model.txt"
PANEL_PATH = DATA_DIR / "panel_district_stage1.csv"
DISTRICTS_PATH = DATA_DIR / "districts.csv"
OUT_JSON = DATA_DIR / "forecasts_latest.json"
OUT_SHAP = DATA_DIR / "shap_values.csv"

FEAT_LABELS_BN = {
    "cases_lag1": "গত সপ্তাহের আসল কেস (cases_lag1)",
    "log_cases_lag1": "গত সপ্তাহের কেসের মাত্রা (log_cases_lag1)",
    "cases_lag2": "২ সপ্তাহ আগের কেস",
    "log_cases_lag2": "২ সপ্তাহ আগের কেসের মাত্রা",
    "cases_lag4": "৪ সপ্তাহ আগের কেস",
    "log_cases_lag4": "৪ সপ্তাহ আগের কেসের মাত্রা",
    "cases_ly": "গত বছর একই সপ্তাহের কেস",
    "log_cases_ly": "গত বছর একই সপ্তাহের মাত্রা",
    "cases_3yr_mean": "৩ বছরের গড় কেস",
    "log_cases_3yr_mean": "৩ বছরের গড় মাত্রা",
    "div_cases_lag1": "বিভাগের গত সপ্তাহের কেস",
    "log_div_cases_lag1": "বিভাগের গত সপ্তাহের মাত্রা",
    "div_cases_lag2": "বিভাগের ২ সপ্তাহ আগের কেস",
    "log_div_cases_lag2": "বিভাগের ২ সপ্তাহ আগের মাত্রা",
    "div_cases_ly": "বিভাগের গত বছরের কেস",
    "nasa_rain_lag2": "২ সপ্তাহ আগের বৃষ্টি (NASA)",
    "nasa_rain_lag3": "৩ সপ্তাহ আগের বৃষ্টি (NASA)",
    "nasa_rain_lag4": "৪ সপ্তাহ আগের বৃষ্টি (NASA)",
    "om_rain_lag2": "২ সপ্তাহ আগের বৃষ্টি (Open-Meteo)",
    "om_rain_lag3": "৩ সপ্তাহ আগের বৃষ্টি (Open-Meteo)",
    "om_rain_lag4": "৪ সপ্তাহ আগের বৃষ্টি (Open-Meteo)",
    "nasa_rain_roll4": "৪ সপ্তাহের মোট বৃষ্টি",
    "nasa_tmean_lag2": "২ সপ্তাহ আগের গড় তাপমাত্রা",
    "nasa_tmean_lag3": "৩ সপ্তাহ আগের গড় তাপমাত্রা",
    "nasa_tmean_lag4": "৪ সপ্তাহ আগের গড় তাপমাত্রা",
    "nasa_tmean_roll4": "৪ সপ্তাহের গড় তাপমাত্রা",
    "nasa_hum_lag2": "২ সপ্তাহ আগের আর্দ্রতা",
    "nasa_hum_lag3": "৩ সপ্তাহ আগের আর্দ্রতা",
    "sin_doy": "মৌসুম ও সময় (sin_doy)",
    "cos_doy": "মৌসুম ও সময় (cos_doy)",
    "month": "মাস (মৌসুমি প্রবণতা)",
    "nat_month_profile": "জাতীয় মাসিক প্রোফাইল",
    "nat_pred_log": "জাতীয় Stage-1 পূর্বাভাস",
    "div_pred_log": "বিভাগীয় Stage-1 পূর্বাভাস",
    "div_pred": "বিভাগীয় Stage-1 মাত্রা",
    "log_pop": "জেলার জনসংখ্যা (log_pop)",
    "urban_share_pct": "শহরাঞ্চলের হার (%)",
}


def classify_risk(pred_cases: float) -> str:
    if pred_cases >= 100.0:
        return "high"
    if pred_cases >= 20.0:
        return "medium"
    return "low"


def run_weekly_forecast() -> dict[str, Any]:
    build_weekly_panel()
    panel = pd.read_csv(PANEL_PATH, parse_dates=["week_start"])
    panel["division"] = panel["division"].astype("category")
    for c in [
        "cases_lag1",
        "cases_lag2",
        "cases_lag4",
        "cases_ly",
        "cases_3yr_mean",
        "div_cases_lag1",
        "div_cases_lag2",
    ]:
        panel[f"log_{c}"] = np.log1p(panel[c])

    booster = lgb.Booster(model_file=str(MODEL_PATH))
    pred_log = booster.predict(panel[FEATS])
    panel["pred_gbm"] = np.expm1(pred_log).clip(min=0)

    cases_lu = {
        (r.district, r.week_start): r.new_cases for r in panel.itertuples(index=False)
    }
    one_week = pd.Timedelta(weeks=1)

    def persistence(district: str, ws: pd.Timestamp, max_back: int = 8) -> float:
        for k in range(1, max_back + 1):
            v = cases_lu.get((district, ws - k * one_week), np.nan)
            if not np.isnan(v):
                return float(v)
        return float("nan")

    panel["pred_persist"] = [
        persistence(d, ws) for d, ws in zip(panel["district"], panel["week_start"])
    ]
    # Fixed 50/50 Blend weights
    panel["pred_blend"] = 0.5 * panel["pred_gbm"] + 0.5 * panel["pred_persist"]

    latest_ws = panel[panel["pred_blend"].notna()]["week_start"].max()
    obs_before = panel[
        (panel["new_cases"].notna()) & (panel["week_start"] < latest_ws)
    ]
    latest_obs_ws = obs_before["week_start"].max()

    latest_df = panel[panel["week_start"] == latest_ws].copy().sort_values("district")

    # TreeSHAP contributions in log-space converted to approximate case-space shares
    shap_matrix = booster.predict(latest_df[FEATS], pred_contrib=True)
    districts_meta = (
        pd.read_csv(DISTRICTS_PATH).set_index("district").to_dict("index")
        if DISTRICTS_PATH.exists()
        else {}
    )

    shap_rows = []
    district_records = []
    for idx, (_, row) in enumerate(latest_df.iterrows()):
        dname = str(row["district"])
        divname = str(row["division"])
        pred_gbm = float(row["pred_gbm"])
        pred_persist = float(row["pred_persist"]) if pd.notna(row["pred_persist"]) else 0.0
        pred_blend = float(row["pred_blend"]) if pd.notna(row["pred_blend"]) else 0.0

        obs_val = cases_lu.get((dname, latest_obs_ws), np.nan)
        actual_cases = None if pd.isna(obs_val) else float(obs_val)

        contribs = shap_matrix[idx][:-1]  # exclude bias term
        abs_sum = float(np.sum(np.abs(contribs))) or 1.0
        top_indices = np.argsort(np.abs(contribs))[::-1][:3]

        reasons = []
        shap_rec: dict[str, Any] = {
            "district": dname,
            "week_start": latest_ws.strftime("%Y-%m-%d"),
        }
        for rank_i, f_idx in enumerate(top_indices, start=1):
            fname = FEATS[int(f_idx)]
            raw_val = float(contribs[int(f_idx)])
            case_share = round((abs(raw_val) / abs_sum) * (0.5 * pred_gbm), 1)
            sign_note = "বাড়িয়েছে" if raw_val >= 0 else "কমিয়েছে"
            label = f"{FEAT_LABELS_BN.get(fname, fname)} ({sign_note})"
            reasons.append(
                {
                    "label": label,
                    "impact": case_share,
                    "log_shap": round(raw_val, 4),
                }
            )
            shap_rec[f"reason_{rank_i}_label"] = label
            shap_rec[f"reason_{rank_i}_impact"] = case_share
            shap_rec[f"reason_{rank_i}_log_shap"] = round(raw_val, 4)

        shap_rows.append(shap_rec)

        meta = districts_meta.get(dname, {})
        district_records.append(
            {
                "district": dname,
                "division": divname,
                "lat": float(meta.get("latitude", 23.8103)),
                "lon": float(meta.get("longitude", 90.4125)),
                "week_start": latest_ws.strftime("%Y-%m-%d"),
                "actual_week": latest_obs_ws.strftime("%Y-%m-%d"),
                "actual_cases": actual_cases,
                "pred_gbm": round(pred_gbm, 1),
                "pred_persist": round(pred_persist, 1),
                "pred_blend": round(pred_blend, 1),
                "risk_level": classify_risk(pred_blend),
                "reasons": reasons,
            }
        )

    pd.DataFrame(shap_rows).to_csv(OUT_SHAP, index=False)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "blend_weights": {"gbm": 0.5, "persistence": 0.5},
        "latest_week": latest_ws.strftime("%Y-%m-%d"),
        "latest_observed_week": latest_obs_ws.strftime("%Y-%m-%d"),
        "districts": district_records,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    result = run_weekly_forecast()
    print(
        f"Precomputed {len(result['districts'])} districts for {result['latest_week']} "
        f"(observed up to {result['latest_observed_week']}) -> {OUT_JSON.name}, {OUT_SHAP.name}"
    )
