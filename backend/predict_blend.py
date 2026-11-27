"""
predict_blend.py — Inference for the best model:
    0.5 * GBM-log(+transfer) + 0.5 * persistence

Usage:
    python 01_build_data.py     # build panels from the dataset folder
    python 02_stage1.py         # stage-1 OOF / forecast features
    python predict_blend.py     # scores panel_district_stage1.csv with the
                                # saved GBM booster and writes predictions.csv

The blend weight (50/50) was fixed in advance, not tuned on the test set.
Persistence = most recent non-missing observed weekly cases for the district
(walks back past masked artefact weeks).
"""
import numpy as np
import pandas as pd
import lightgbm as lgb
from pathlib import Path

OUT = Path(__file__).resolve().parent

FEATS = [
    "sin_doy", "cos_doy", "month", "cal_year",
    "log_pop", "log_area", "urban_share_pct", "latitude", "longitude",
    "cases_lag1", "cases_lag2", "cases_lag4", "cases_ly", "cases_3yr_mean",
    "cases_3yr_n",
    "log_cases_lag1", "log_cases_lag2", "log_cases_lag4", "log_cases_ly",
    "log_cases_3yr_mean",
    "div_cases_lag1", "div_cases_lag2", "div_cases_ly",
    "log_div_cases_lag1", "log_div_cases_lag2",
    "nasa_rain_lag2", "nasa_rain_lag3", "nasa_rain_lag4",
    "nasa_tmean_lag2", "nasa_tmean_lag3", "nasa_tmean_lag4",
    "nasa_hum_lag2", "nasa_hum_lag3",
    "om_rain_lag2", "om_rain_lag3", "om_rain_lag4",
    "nasa_rain_roll4", "nasa_tmean_roll4",
    "nat_month_profile",
    "division",
    # transfer features — order must match 03_train_gbm.py exactly:
    # LightGBM Booster.predict aligns features by POSITION, not by name.
    "nat_pred_log", "div_pred_log", "div_pred",
]


def main():
    p = pd.read_csv(OUT / "panel_district_stage1.csv",
                    parse_dates=["week_start"])
    p["division"] = p["division"].astype("category")
    for c in ["cases_lag1", "cases_lag2", "cases_lag4", "cases_ly",
              "cases_3yr_mean", "div_cases_lag1", "div_cases_lag2"]:
        p[f"log_{c}"] = np.log1p(p[c])

    booster = lgb.Booster(model_file=str(OUT / "gbm_transfer_model.txt"))
    pred_log = booster.predict(p[FEATS])
    p["pred_gbm"] = np.expm1(pred_log).clip(min=0)

    cases_lu = {(r.district, r.week_start): r.new_cases
                for r in p.itertuples(index=False)}
    W = pd.Timedelta(weeks=1)

    def persistence(district, ws, max_back=8):
        for k in range(1, max_back + 1):
            v = cases_lu.get((district, ws - k * W), np.nan)
            if not np.isnan(v):
                return v
        return np.nan

    p["pred_persist"] = [persistence(d, ws) for d, ws in
                         zip(p["district"], p["week_start"])]
    p["pred_blend"] = 0.5 * p["pred_gbm"] + 0.5 * p["pred_persist"]
    out = p[["district", "division", "week_start", "split", "target_valid",
             "new_cases", "pred_gbm", "pred_persist", "pred_blend"]]
    out.to_csv(OUT / "predictions.csv", index=False)
    print(f"wrote predictions.csv ({len(out)} rows)")


if __name__ == "__main__":
    main()
