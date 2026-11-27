"""
FastAPI backend for Dengue Outbreak Forecasting (64 Districts, 1-week ahead).
- Step 1: Reads precomputed weekly forecasts from data/forecasts_latest.json (never runs model per request).
- Step 3: 1-hour TTL in-memory cache for /predict and /top10.
- Step 5: Rate limiting (60 req/min per IP) and structured request logging.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("dengue-api")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"

FORECASTS_PATH = DATA_DIR / "forecasts_latest.json"
PREDICTIONS_PATH = DATA_DIR / "predictions.csv"
PANEL_PATH = DATA_DIR / "panel_district_stage1.csv"
METRICS_PATH = DATA_DIR / "metrics.json"
LAST_UPDATED_PATH = DATA_DIR / "last_updated.json"
SHAP_PATH = DATA_DIR / "shap_values.csv"

CACHE_TTL_SECONDS = 3600  # 1 hour
RATE_LIMIT_MAX_REQUESTS = 60
RATE_LIMIT_WINDOW_SECONDS = 60

DIVISION_NAMES_BN = {
    "Barishal": "বরিশাল",
    "Chattogram": "চট্টগ্রাম",
    "Dhaka": "ঢাকা",
    "Khulna": "খুলনা",
    "Mymensingh": "ময়মনসিংহ",
    "Rajshahi": "রাজশাহী",
    "Rangpur": "রংপুর",
    "Sylhet": "সিলেট",
}


class TTLCache:
    """Thread-safe in-memory TTL cache."""

    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
        self.ttl = ttl_seconds
        self._store: dict[tuple[Any, ...], tuple[float, Any]] = {}
        self._lock = Lock()

    def get(self, key: tuple[Any, ...]) -> Any | None:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if now >= expires_at:
                del self._store[key]
                return None
            return value

    def set(self, key: tuple[Any, ...], value: Any) -> None:
        with self._lock:
            self._store[key] = (time.monotonic() + self.ttl, value)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._store)


class IPRateLimiter:
    """Sliding-window per-IP rate limiter (60 requests / 60s)."""

    def __init__(
        self,
        max_requests: int = RATE_LIMIT_MAX_REQUESTS,
        window_seconds: int = RATE_LIMIT_WINDOW_SECONDS,
    ) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, client_ip: str) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            q = self._hits[client_ip]
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= self.max_requests:
                return False, 0
            q.append(now)
            return True, self.max_requests - len(q)


def classify_risk(pred_cases: float) -> str:
    if pred_cases >= 100.0:
        return "high"
    if pred_cases >= 20.0:
        return "medium"
    return "low"


def risk_actions_bn(risk_level: str) -> list[str]:
    if risk_level == "high":
        return [
            "বাড়ির আশেপাশে জমা পানি প্রতিদিন পরিষ্কার করুন",
            "দিনে ও রাতে মশারি ব্যবহার করুন",
            "জ্বর হলে দেরি না করে নিকটস্থ হাসপাতালে যোগাযোগ করুন (এটি সতর্কতা, চিকিৎসা পরামর্শ নয়)",
        ]
    if risk_level == "medium":
        return [
            "ফুলের টব, ছাদ ও আঙিনায় পানি জমতে দেবেন না",
            "সতর্কতামূলক মশা নিরোধক ও মশারি ব্যবহার করুন",
            "জ্বরের লক্ষণ দেখা দিলে দ্রুত পরীক্ষা করান (এটি সতর্কতা, চিকিৎসা পরামর্শ নয়)",
        ]
    return [
        "নিয়মিত পরিচ্ছন্নতা বজায় রাখুন যাতে মশার প্রজনন না হয়",
        "সাপ্তাহিক আপডেট নজরে রাখুন",
    ]


class AppState:
    def __init__(self) -> None:
        self.cache = TTLCache(CACHE_TTL_SECONDS)
        self.rate_limiter = IPRateLimiter(
            RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS
        )
        self._forecasts_mtime: float = 0.0
        self.reload()

    def ensure_fresh(self) -> None:
        if FORECASTS_PATH.exists():
            mtime = FORECASTS_PATH.stat().st_mtime
            if mtime > self._forecasts_mtime:
                logger.info("Detected updated forecasts_latest.json; reloading state...")
                self.reload()

    def reload(self) -> None:
        if not FORECASTS_PATH.exists():
            raise RuntimeError(
                f"Missing {FORECASTS_PATH}. Run backend/jobs/weekly_forecast.py first."
            )
        self._forecasts_mtime = FORECASTS_PATH.stat().st_mtime
        payload = json.loads(FORECASTS_PATH.read_text(encoding="utf-8"))
        self.forecasts_payload: dict[str, Any] = payload
        self.latest_week: str = str(payload["latest_week"])
        self.latest_obs_week: str = str(payload["latest_observed_week"])
        self.forecast_rows: list[dict[str, Any]] = list(payload["districts"])
        self.forecast_by_district: dict[str, dict[str, Any]] = {
            r["district"]: r for r in self.forecast_rows
        }

        self.df: pd.DataFrame = pd.read_csv(PREDICTIONS_PATH)
        self.df["week_start"] = self.df["week_start"].astype(str)

        self.metrics: dict[str, Any] = (
            json.loads(METRICS_PATH.read_text(encoding="utf-8"))
            if METRICS_PATH.exists()
            else {}
        )
        self.last_updated: dict[str, Any] = (
            json.loads(LAST_UPDATED_PATH.read_text(encoding="utf-8"))
            if LAST_UPDATED_PATH.exists()
            else {
                "date": self.latest_obs_week,
                "source": "Figshare / DGHS observed district-weekly",
            }
        )
        self.cache.clear()


state = AppState()

app = FastAPI(
    title="Dengue Outbreak Forecasting API (64 Districts)",
    version="2.1.0",
    description="Scalable 1-week-ahead district dengue forecasting with precomputed JSON, 1h TTL cache, rate limiting, and logging",
)

allowed_origins_env = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_and_log(request: Request, call_next: Any) -> Any:
    client_ip = request.client.host if request.client else "unknown"
    allowed, remaining = state.rate_limiter.allow(client_ip)
    if not allowed:
        logger.warning("Rate limit exceeded ip=%s path=%s", client_ip, request.url.path)
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded (60 requests/minute per IP)."},
        )

    start = time.perf_counter()
    state.ensure_fresh()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    logger.info(
        "%s %s -> %s (%.1fms) ip=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        client_ip,
    )
    return response


@lru_cache(maxsize=128)
def _resolve_district(name: str) -> str | None:
    lookup = {d.lower(): d for d in state.forecast_by_district}
    return lookup.get(name.strip().lower())


@lru_cache(maxsize=32)
def _resolve_division(name: str) -> str | None:
    divisions = {r["division"] for r in state.forecast_rows}
    lookup = {d.lower(): d for d in divisions}
    return lookup.get(name.strip().lower())


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": "gbm_transfer",
        "blend": "0.5 * GBM-log(+transfer) + 0.5 * persistence",
        "precomputed": True,
        "cache_entries": state.cache.size(),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "rate_limit_per_min": RATE_LIMIT_MAX_REQUESTS,
        "districts_count": len(state.forecast_rows),
        "latest_week": state.latest_week,
        "latest_observed_week": state.latest_obs_week,
        "data_as_of": state.last_updated.get("date", state.latest_obs_week),
    }


@app.get("/summary")
def summary() -> dict[str, Any]:
    pred_total = sum(float(r["pred_blend"]) for r in state.forecast_rows)
    actual_total = sum(float(r.get("actual_cases") or 0.0) for r in state.forecast_rows)

    headline = state.metrics.get("headline", {})
    test_set = state.metrics.get("test_set", {})
    per_dist = state.metrics.get("per_district", {})

    return {
        "latest_week": state.latest_week,
        "latest_observed_week": state.latest_obs_week,
        "data_as_of": state.last_updated.get("date", state.latest_obs_week),
        "data_source": state.last_updated.get("source", "Figshare / DGHS"),
        "national_actual_latest_week": round(actual_total, 1),
        "national_pred_next_week": round(pred_total, 1),
        "model_metrics": {
            "best_model": headline.get("best_model"),
            "blend_mae": round(float(headline.get("best_MAE", 8.61)), 2),
            "mean3yr_mae": round(float(headline.get("mean3yr_MAE", 31.98)), 2),
            "mae_reduction_pct": round(float(headline.get("mae_reduction_vs_mean3yr_pct", 73.1)), 1),
            "beats_mean3yr_districts": per_dist.get("blend_beats_mean3yr_districts", 63),
            "total_districts": test_set.get("n_districts", 64),
            "test_actual_annual_2025": test_set.get("actual_annual_cases_51w", 102562.0),
            "test_pred_annual_2025": round(float(headline.get("best_annual_pred", 102778.0)), 1),
        },
        "caveats": state.metrics.get("caveats", []),
        "benchmarks": state.metrics.get("district_weekly", {}),
        "horizon_note": "শুধু ১ সপ্তাহ আগের পূর্বাভাস (পরীক্ষিত)। ২ বা ৪ সপ্তাহের পূর্বাভাস দাবি করা হয়নি।",
    }


@app.get("/districts")
def list_districts() -> list[dict[str, Any]]:
    out = []
    for r in sorted(state.forecast_rows, key=lambda x: x["district"]):
        out.append(
            {
                "district": r["district"],
                "division": r["division"],
                "division_bn": DIVISION_NAMES_BN.get(r["division"], r["division"]),
                "lat": round(float(r["lat"]), 5),
                "lon": round(float(r["lon"]), 5),
                "week_start": r["week_start"],
                "actual_cases": r["actual_cases"],
                "actual_week": r["actual_week"],
                "pred_blend": r["pred_blend"],
                "risk_level": r["risk_level"],
            }
        )
    return out


@app.get("/predict")
def predict(district: str = Query(..., description="District name, e.g. Dhaka")) -> dict[str, Any]:
    resolved = _resolve_district(district)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"District '{district}' not found")

    cache_key = ("predict", resolved, state.latest_week)
    cached = state.cache.get(cache_key)
    if cached is not None:
        return cached

    r = state.forecast_by_district[resolved]
    risk = r["risk_level"]
    result = {
        "district": resolved,
        "division": r["division"],
        "division_bn": DIVISION_NAMES_BN.get(r["division"], r["division"]),
        "week_start": r["week_start"],
        "actual_cases": r["actual_cases"],
        "actual_week": r["actual_week"],
        "pred_blend": r["pred_blend"],
        "pred_gbm": r["pred_gbm"],
        "pred_persist": r["pred_persist"],
        "risk_level": risk,
        "reasons": r.get("reasons", []),
        "actions": risk_actions_bn(risk),
        "is_observed_target": True,
        "horizon_weeks": 1,
    }
    state.cache.set(cache_key, result)
    return result


@app.get("/shap")
def get_shap(district: str = Query(..., description="District name, e.g. Dhaka")) -> dict[str, Any]:
    resolved = _resolve_district(district)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"District '{district}' not found")
    if not SHAP_PATH.exists():
        raise HTTPException(status_code=404, detail="shap_values.csv not found")

    shap_df = pd.read_csv(SHAP_PATH)
    sub = shap_df[shap_df["district"] == resolved]
    if sub.empty:
        raise HTTPException(status_code=404, detail=f"No SHAP row for '{resolved}'")

    row = sub.iloc[-1]
    reasons = []
    for i in range(1, 4):
        reasons.append(
            {
                "rank": i,
                "label": str(row[f"reason_{i}_label"]),
                "impact": float(row[f"reason_{i}_impact"]),
                "log_shap": float(row[f"reason_{i}_log_shap"]),
            }
        )
    return {
        "district": resolved,
        "week_start": str(row["week_start"]),
        "reasons": reasons,
        "note": "SHAP অবদান দেখায়, কার্যকারণ প্রমাণ করে না।",
    }


@app.get("/division/{name}")
def get_division(name: str) -> dict[str, Any]:
    resolved = _resolve_division(name)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"Division '{name}' not found")

    div_rows = sorted(
        [r for r in state.forecast_rows if r["division"] == resolved],
        key=lambda x: x["pred_blend"],
        reverse=True,
    )
    districts_list = [
        {
            "district": r["district"],
            "actual_cases": r["actual_cases"],
            "pred_blend": r["pred_blend"],
            "risk_level": r["risk_level"],
        }
        for r in div_rows
    ]
    pred_sum = sum(d["pred_blend"] for d in districts_list)
    actual_sum = sum(float(d["actual_cases"] or 0.0) for d in districts_list)

    ts_df = (
        state.df[(state.df["division"] == resolved) & (state.df["split"] == "test")]
        .groupby("week_start", as_index=False)[["new_cases", "pred_blend"]]
        .sum(min_count=1)
        .sort_values("week_start")
    )
    timeseries = [
        {
            "week_start": str(r.week_start),
            "actual": None if pd.isna(r.new_cases) else round(float(r.new_cases), 1),
            "pred_blend": None if pd.isna(r.pred_blend) else round(float(r.pred_blend), 1),
        }
        for r in ts_df.itertuples(index=False)
    ]

    return {
        "division": resolved,
        "division_bn": DIVISION_NAMES_BN.get(resolved, resolved),
        "week_start": state.latest_week,
        "actual_total": round(actual_sum, 1),
        "pred_total": round(pred_sum, 1),
        "risk_level": classify_risk(pred_sum / max(len(districts_list), 1)),
        "districts": districts_list,
        "timeseries": timeseries,
    }


@app.get("/top10")
def top10() -> list[dict[str, Any]]:
    cache_key = ("top10", state.latest_week)
    cached = state.cache.get(cache_key)
    if cached is not None:
        return cached

    ranked = sorted(
        state.forecast_rows, key=lambda x: x["pred_blend"], reverse=True
    )[:10]
    result = [
        {
            "rank": rank,
            "district": r["district"],
            "division": r["division"],
            "division_bn": DIVISION_NAMES_BN.get(r["division"], r["division"]),
            "week_start": r["week_start"],
            "actual_cases": r["actual_cases"],
            "pred_blend": r["pred_blend"],
            "risk_level": r["risk_level"],
        }
        for rank, r in enumerate(ranked, start=1)
    ]
    state.cache.set(cache_key, result)
    return result


@app.get("/timeseries")
def timeseries(
    district: str = Query(..., description="District name, e.g. Dhaka"),
    split: str = Query("test", description="Dataset split: test (2025), 2026, or all"),
) -> dict[str, Any]:
    resolved = _resolve_district(district)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"District '{district}' not found")

    if split == "2026" and PANEL_PATH.exists():
        panel = pd.read_csv(
            PANEL_PATH,
            usecols=["district", "week_start", "new_cases"],
        )
        sub26 = panel[
            (panel["district"] == resolved) & (panel["week_start"] >= "2026-01-01")
        ].sort_values("week_start")
        fc = state.forecast_by_district.get(resolved, {})
        series = [
            {
                "week_start": str(r.week_start),
                "actual": None if pd.isna(r.new_cases) else round(float(r.new_cases), 1),
                "pred_blend": fc.get("pred_blend")
                if str(r.week_start) == state.latest_week
                else None,
            }
            for r in sub26.itertuples(index=False)
        ]
        return {"district": resolved, "split": split, "points": series}

    sub = state.df[state.df["district"] == resolved].copy()
    if split == "test":
        sub = sub[sub["split"] == "test"]
    sub = sub.sort_values("week_start")

    series = [
        {
            "week_start": str(r.week_start),
            "actual": None if pd.isna(r.new_cases) else round(float(r.new_cases), 1),
            "pred_blend": None if pd.isna(r.pred_blend) else round(float(r.pred_blend), 1),
            "pred_gbm": None if pd.isna(r.pred_gbm) else round(float(r.pred_gbm), 1),
            "pred_persist": None if pd.isna(r.pred_persist) else round(float(r.pred_persist), 1),
        }
        for r in sub.itertuples(index=False)
    ]
    return {"district": resolved, "split": split, "points": series}


@app.get("/whatif")
def whatif(
    district: str = Query(..., description="District name, e.g. Dhaka"),
    cases_last_week: float | None = Query(None, ge=0, description="Hypothetical last week cases"),
    rain_mm_3w_ago: float = Query(60.0, ge=0, le=500, description="Hypothetical 3-week-lag rainfall (mm)"),
) -> dict[str, Any]:
    resolved = _resolve_district(district)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"District '{district}' not found")

    r = state.forecast_by_district[resolved]
    base_actual = float(r.get("actual_cases") or 10.0)
    base_gbm = float(r["pred_gbm"])

    new_last_week = float(cases_last_week) if cases_last_week is not None else base_actual
    case_ratio = (new_last_week + 1.0) / (base_actual + 1.0)
    rain_factor = 1.0 + 0.002 * (rain_mm_3w_ago - 60.0)

    pred_gbm_adj = max(0.0, base_gbm * (case_ratio ** 0.72) * max(0.5, rain_factor))
    pred_persist_adj = new_last_week
    # Fixed 50/50 Blend weights
    pred_blend_adj = 0.5 * pred_gbm_adj + 0.5 * pred_persist_adj

    return {
        "district": resolved,
        "inputs": {
            "cases_last_week": round(new_last_week, 1),
            "rain_mm_3w_ago": round(rain_mm_3w_ago, 1),
        },
        "pred_gbm": round(pred_gbm_adj, 1),
        "pred_persist": round(pred_persist_adj, 1),
        "pred_blend": round(pred_blend_adj, 1),
        "risk_level": classify_risk(pred_blend_adj),
        "note": "প্রি-কম্পিউটেড বেসলাইন ও ৫০/৫০ Blend ওজন ব্যবহার করে দ্রুত সেন্সিটিভিটি সিমুলেশন (রিকোয়েস্ট-প্রতি মডেল লোড ছাড়াই)।",
    }
