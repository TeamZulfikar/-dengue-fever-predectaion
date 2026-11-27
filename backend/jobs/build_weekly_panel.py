"""
build_weekly_panel.py — Bridges daily observed DGHS cases (dengue_district_daily_observed.csv)
and Open-Meteo weather (weather_latest.csv) into the weekly panel (panel_district_stage1.csv)
with all 43 features in the exact FEATS order required by predict_blend.py.

Rules respected:
- Only observed daily cases are aggregated (never estimated cases).
- Never modifies model files or the 50/50 Blend weights.
- Preserves all historical rows (<= 2026-06-29) and extends weekly rows up to
  the 1-week-ahead forecast week (latest observed week + 7 days).
"""
from __future__ import annotations

import logging
import math
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("build-weekly-panel")

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR.parent / "data"
MODEL_DIR = BACKEND_DIR / "model"

PANEL_PATH = DATA_DIR / "panel_district_stage1.csv"
DAILY_PATH = DATA_DIR / "dengue_district_daily_observed.csv"
WEATHER_PATH = DATA_DIR / "weather_latest.csv"
DISTRICTS_PATH = DATA_DIR / "districts.csv"

STAGE1_MONTHLY_PATH = MODEL_DIR / "stage1_monthly_model.txt"
STAGE1_DIVISION_PATH = MODEL_DIR / "stage1_division_model.txt"

HISTORICAL_CUTOFF = pd.Timestamp("2026-06-29")


def _monday_of(dt: pd.Series) -> pd.Series:
    return dt - pd.to_timedelta(dt.dt.weekday, unit="D")


def build_weekly_panel() -> tuple[pd.Timestamp, pd.Timestamp]:
    """
    Extend panel_district_stage1.csv from observed daily cases + weather_latest.csv
    and compute all 43 features + Stage-1 transfer features.
    Returns (latest_obs_week, forecast_week).
    """
    base_panel = pd.read_csv(PANEL_PATH, parse_dates=["week_start"])
    daily = pd.read_csv(DAILY_PATH, parse_dates=["date"])
    districts_meta = pd.read_csv(DISTRICTS_PATH)

    # Keep only observed daily rows and map to ISO week Monday
    daily = daily[daily["new_cases"].notna()].copy()
    daily["week_start"] = _monday_of(daily["date"])

    # Aggregate observed daily cases by (district, week_start)
    # Require at least 4 observed days in a week to treat weekly sum as valid observed,
    # except for the latest week if it has >= 5 days (e.g. partial current week)
    wk_obs = (
        daily.groupby(["district", "division", "week_start"], as_index=False)
        .agg(
            new_cases=("new_cases", "sum"),
            cumulative_cases=("cumulative_cases", "max"),
            cumulative_deaths=("cumulative_deaths", "max"),
            n_days=("date", "nunique"),
        )
    )

    latest_obs_week = wk_obs[wk_obs["n_days"] >= 5]["week_start"].max()
    forecast_week = latest_obs_week + pd.Timedelta(weeks=1)

    # Preserve historical panel rows up to HISTORICAL_CUTOFF
    hist = base_panel[base_panel["week_start"] <= HISTORICAL_CUTOFF].copy()

    # Build weekly grid from HISTORICAL_CUTOFF + 1 week through forecast_week
    new_weeks = pd.date_range(
        HISTORICAL_CUTOFF + pd.Timedelta(weeks=1),
        forecast_week,
        freq="7D",
    )
    if len(new_weeks) == 0:
        logger.info("No new weeks beyond %s", HISTORICAL_CUTOFF.strftime("%Y-%m-%d"))
        return latest_obs_week, forecast_week

    all_districts = sorted(districts_meta["district"].unique())
    grid = pd.MultiIndex.from_product(
        [all_districts, new_weeks], names=["district", "week_start"]
    ).to_frame(index=False)

    # Merge static BBS district metadata
    districts_meta = districts_meta.copy()
    districts_meta["log_pop"] = np.log1p(districts_meta["population_2022"])
    districts_meta["log_area"] = np.log1p(districts_meta["area_km2"])
    grid = grid.merge(districts_meta, on="district", how="left")

    # Merge observed weekly cases (NaN for missing weeks / future forecast_week)
    wk_valid = wk_obs[wk_obs["n_days"] >= 4][
        ["district", "week_start", "new_cases", "cumulative_cases", "cumulative_deaths"]
    ].copy()
    grid = grid.merge(wk_valid, on=["district", "week_start"], how="left")
    grid["target_valid"] = grid["new_cases"].notna()
    grid["new_deaths"] = np.nan
    grid["currently_admitted"] = np.nan
    grid["population"] = grid["population_2022"]
    grid["incidence"] = np.where(
        grid["new_cases"].notna(),
        grid["new_cases"] / grid["population_2022"] * 100000.0,
        np.nan,
    )

    # Weather: aggregate Open-Meteo daily if available, fallback to district-month climatology
    clim = (
        hist.groupby(["district", "month"], as_index=False)[
            ["nasa_rain", "nasa_tmean", "nasa_hum", "om_rain", "om_tmean"]
        ]
        .mean()
        .rename(
            columns={
                "nasa_rain": "clim_nasa_rain",
                "nasa_tmean": "clim_nasa_tmean",
                "nasa_hum": "clim_nasa_hum",
                "om_rain": "clim_om_rain",
                "om_tmean": "clim_om_tmean",
            }
        )
    )

    grid["month"] = grid["week_start"].dt.month
    grid["cal_year"] = grid["week_start"].dt.year
    grid["year"] = grid["week_start"].dt.year
    grid["iso_week"] = grid["week_start"].dt.isocalendar().week.astype(int)
    doy = grid["week_start"].dt.dayofyear
    grid["sin_doy"] = np.sin(2.0 * math.pi * doy / 365.25)
    grid["cos_doy"] = np.cos(2.0 * math.pi * doy / 365.25)

    grid = grid.merge(clim, on=["district", "month"], how="left")

    if WEATHER_PATH.exists():
        wdf = pd.read_csv(WEATHER_PATH, parse_dates=["date"])
        wdf["week_start"] = _monday_of(wdf["date"])
        w_wk = (
            wdf.groupby(["district", "week_start"], as_index=False)
            .agg(
                om_rain=("precipitation_sum", "sum"),
                om_tmean=("temperature_2m_mean", "mean"),
            )
        )
        grid = grid.merge(w_wk, on=["district", "week_start"], how="left")
        grid["om_rain"] = grid["om_rain"].fillna(grid["clim_om_rain"])
        grid["om_tmean"] = grid["om_tmean"].fillna(grid["clim_om_tmean"])
    else:
        grid["om_rain"] = grid["clim_om_rain"]
        grid["om_tmean"] = grid["clim_om_tmean"]

    grid["nasa_rain"] = grid["om_rain"].fillna(grid["clim_nasa_rain"])
    grid["nasa_tmean"] = grid["om_tmean"].fillna(grid["clim_nasa_tmean"])
    grid["nasa_hum"] = grid["clim_nasa_hum"]
    grid["nasa_tmax"] = np.nan
    grid["nasa_tmin"] = np.nan
    grid["nasa_wind"] = np.nan
    grid["nasa_solar"] = np.nan
    grid["split"] = "live"

    # National monthly profile from historical panel
    nat_prof = (
        hist.groupby("month", as_index=False)["nat_month_profile"].first()
    )
    grid = grid.merge(nat_prof, on="month", how="left")

    # Combine historical + new grid to compute date-merged lags cleanly
    common_cols = [c for c in hist.columns if c in grid.columns]
    combined = pd.concat([hist, grid[common_cols]], ignore_index=True)
    combined = combined.sort_values(["district", "week_start"]).reset_index(drop=True)

    # Build date-merged lookup for cases & weather
    W = pd.Timedelta(weeks=1)
    case_lu = combined[["district", "week_start", "new_cases"]].copy()

    def add_case_lag(df: pd.DataFrame, k_weeks: int, col_name: str) -> pd.DataFrame:
        ref = case_lu.copy()
        ref["week_start"] = ref["week_start"] + k_weeks * W
        ref = ref.rename(columns={"new_cases": col_name})
        return df.merge(ref, on=["district", "week_start"], how="left")

    # Recompute lags only on new rows, then merge back into hist
    new_mask = combined["week_start"] > HISTORICAL_CUTOFF
    new_part = combined[new_mask].drop(
        columns=[
            "cases_lag1", "cases_lag2", "cases_lag4", "cases_ly",
            "cases_3yr_mean", "cases_3yr_n",
            "nasa_rain_lag2", "nasa_rain_lag3", "nasa_rain_lag4",
            "nasa_tmean_lag2", "nasa_tmean_lag3", "nasa_tmean_lag4",
            "nasa_hum_lag2", "nasa_hum_lag3", "nasa_hum_lag4",
            "om_rain_lag2", "om_rain_lag3", "om_rain_lag4",
            "nasa_rain_roll4", "nasa_tmean_roll4",
            "div_cases_lag1", "div_cases_lag2", "div_cases_ly",
            "nat_pred_log", "div_pred_log", "div_pred",
        ],
        errors="ignore",
    )

    new_part = add_case_lag(new_part, 1, "cases_lag1")
    new_part = add_case_lag(new_part, 2, "cases_lag2")
    new_part = add_case_lag(new_part, 4, "cases_lag4")
    new_part = add_case_lag(new_part, 52, "cases_ly")

    # 3-year same-week mean (52w, 104w, 156w back)
    ly1 = add_case_lag(new_part[["district", "week_start"]], 52, "y1")["y1"]
    ly2 = add_case_lag(new_part[["district", "week_start"]], 104, "y2")["y2"]
    ly3 = add_case_lag(new_part[["district", "week_start"]], 156, "y3")["y3"]
    ly_mat = np.vstack([ly1.values, ly2.values, ly3.values])
    new_part["cases_3yr_n"] = np.sum(~np.isnan(ly_mat), axis=0)
    new_part["cases_3yr_mean"] = np.nanmean(ly_mat, axis=0)

    # Weather lags (2, 3, 4 weeks back)
    w_lu = combined[
        ["district", "week_start", "nasa_rain", "nasa_tmean", "nasa_hum", "om_rain"]
    ].copy()
    for k in (2, 3, 4):
        ref = w_lu.copy()
        ref["week_start"] = ref["week_start"] + k * W
        ref = ref.rename(
            columns={
                "nasa_rain": f"nasa_rain_lag{k}",
                "nasa_tmean": f"nasa_tmean_lag{k}",
                "nasa_hum": f"nasa_hum_lag{k}",
                "om_rain": f"om_rain_lag{k}",
            }
        )
        new_part = new_part.merge(ref, on=["district", "week_start"], how="left")

    new_part["nasa_rain_roll4"] = new_part[
        ["nasa_rain_lag2", "nasa_rain_lag3", "nasa_rain_lag4"]
    ].sum(axis=1, min_count=1) * (4.0 / 3.0)
    new_part["nasa_tmean_roll4"] = new_part[
        ["nasa_tmean_lag2", "nasa_tmean_lag3", "nasa_tmean_lag4"]
    ].mean(axis=1)

    # Division lags (sum of district cases per division-week)
    div_wk = (
        combined.groupby(["division", "week_start"], as_index=False)["new_cases"]
        .sum(min_count=1)
    )
    for k, cname in [(1, "div_cases_lag1"), (2, "div_cases_lag2"), (52, "div_cases_ly")]:
        ref = div_wk.copy()
        ref["week_start"] = ref["week_start"] + k * W
        ref = ref.rename(columns={"new_cases": cname})
        new_part = new_part.merge(ref, on=["division", "week_start"], how="left")

    # Stage-1 transfer features using saved Stage-1 LightGBM models
    if STAGE1_MONTHLY_PATH.exists():
        m_mon = lgb.Booster(model_file=str(STAGE1_MONTHLY_PATH))
        mon_feats = m_mon.feature_name()
        # Approximate monthly inputs from recent lags + climatology
        mon_df = pd.DataFrame(
            {
                "sin_m": np.sin(2.0 * math.pi * new_part["month"] / 12.0),
                "cos_m": np.cos(2.0 * math.pi * new_part["month"] / 12.0),
                "year_n": new_part["cal_year"] - 2000,
                "logcases_lag1": np.log1p(new_part["cases_lag1"].fillna(0) * 4.3),
                "logcases_lag2": np.log1p(new_part["cases_lag4"].fillna(0) * 4.3),
                "logcases_lag12": np.log1p(new_part["cases_ly"].fillna(0) * 4.3),
                "temp_mean_c_lag1": new_part["nasa_tmean_lag2"].fillna(28.0),
                "temp_mean_c_lag2": new_part["nasa_tmean_lag4"].fillna(28.0),
                "rainfall_mm_month_lag1": new_part["nasa_rain_lag2"].fillna(0) * 4.0,
                "rainfall_mm_month_lag2": new_part["nasa_rain_lag4"].fillna(0) * 4.0,
                "humidity_pct_lag1": new_part["nasa_hum_lag2"].fillna(80.0),
                "humidity_pct_lag2": new_part["nasa_hum_lag4"].fillna(80.0),
            }
        )[mon_feats]
        new_part["nat_pred_log"] = m_mon.predict(mon_df)
    else:
        new_part["nat_pred_log"] = 0.0

    if STAGE1_DIVISION_PATH.exists():
        m_div = lgb.Booster(model_file=str(STAGE1_DIVISION_PATH))
        div_feats = m_div.feature_name()
        div_df = pd.DataFrame(
            {
                "sin_doy": new_part["sin_doy"],
                "cos_doy": new_part["cos_doy"],
                "month": new_part["month"],
                "cal_year": new_part["cal_year"],
                "log_pop": new_part["log_pop"],
                "cases_lag1": new_part["div_cases_lag1"].fillna(0),
                "cases_lag2": new_part["div_cases_lag2"].fillna(0),
                "cases_lag4": new_part["div_cases_lag2"].fillna(0),
                "cases_ly": new_part["div_cases_ly"].fillna(0),
                "cases_3yr_mean": new_part["cases_3yr_mean"].fillna(0),
                "div_rain_lag2": new_part["nasa_rain_lag2"].fillna(0),
                "div_rain_lag3": new_part["nasa_rain_lag3"].fillna(0),
                "div_rain_lag4": new_part["nasa_rain_lag4"].fillna(0),
                "div_tmean_lag2": new_part["nasa_tmean_lag2"].fillna(28.0),
                "div_tmean_lag3": new_part["nasa_tmean_lag3"].fillna(28.0),
                "div_tmean_lag4": new_part["nasa_tmean_lag4"].fillna(28.0),
                "div_hum_lag2": new_part["nasa_hum_lag2"].fillna(80.0),
                "div_hum_lag3": new_part["nasa_hum_lag3"].fillna(80.0),
                "div_rain_om_lag2": new_part["om_rain_lag2"].fillna(0),
                "div_rain_om_lag3": new_part["om_rain_lag3"].fillna(0),
                "division": new_part["division"].astype("category"),
            }
        )[div_feats]
        new_part["div_pred_log"] = m_div.predict(div_df)
        new_part["div_pred"] = np.clip(np.expm1(new_part["div_pred_log"]), 0, None)
    else:
        new_part["div_pred_log"] = 0.0
        new_part["div_pred"] = 0.0

    # Align columns identically to historical panel and write out
    final_df = pd.concat([hist, new_part[hist.columns]], ignore_index=True)
    final_df = final_df.sort_values(["district", "week_start"]).reset_index(drop=True)
    final_df.to_csv(PANEL_PATH, index=False)
    logger.info(
        "Updated %s: %d rows, latest_obs_week=%s, forecast_week=%s",
        PANEL_PATH.name,
        len(final_df),
        latest_obs_week.strftime("%Y-%m-%d"),
        forecast_week.strftime("%Y-%m-%d"),
    )
    return latest_obs_week, forecast_week


if __name__ == "__main__":
    obs_w, fc_w = build_weekly_panel()
    print(f"Panel updated: latest_obs_week={obs_w.strftime('%Y-%m-%d')}, forecast_week={fc_w.strftime('%Y-%m-%d')}")
