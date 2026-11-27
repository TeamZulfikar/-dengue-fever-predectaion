# Dengue Outbreak Forecasting Dashboard (64 Districts)

1-week-ahead district dengue forecasting dashboard built with FastAPI + LightGBM (`0.5 * GBM-log(+transfer) + 0.5 * persistence`, weights fixed in advance) and Next.js + React + Tailwind + Leaflet.

## Structure

- `backend/` — FastAPI server (`app.py`), precompute & refresh jobs (`jobs/weekly_forecast.py`, `jobs/daily_refresh.py`), scrapers (`scraper/dghs_daily.py`, `scraper/weather.py`), model artifacts (`model/`), and API test suite (`test_api.py`).
- `frontend/` — Next.js App Router dashboard (`src/app/page.tsx`), interactive 64-district Leaflet + Esri map (`src/components/BangladeshMap.tsx`), 64-district comparison table (`src/components/DistrictExplorer.tsx`), model benchmarks (`src/components/ModelIntelligence.tsx`), 2025 timeseries chart (`src/components/TimeseriesChart.tsx`), What-if sensitivity simulator (`src/components/WhatIfSimulator.tsx`), GeoJSON (`public/bangladesh-districts.geojson`), and offline snapshot (`public/offline-snapshot.json`).
- `data/` — `forecasts_latest.json`, `shap_values.csv`, `predictions.csv`, `metrics.json`, `districts.csv`, `dengue_district_daily_observed.csv`, and `sample_pdfs/`.
- `.github/workflows/test.yml` — Automated CI workflow.

## Precomputed Forecasts & SHAP (`GET /shap`)

- `backend/jobs/weekly_forecast.py` runs the 50/50 Blend model once per week for all 64 districts and writes `data/forecasts_latest.json` and `data/shap_values.csv` using LightGBM's native TreeSHAP (`pred_contrib=True`).
- API endpoints read directly from `data/forecasts_latest.json` and never load or run the LightGBM model per request.
- `GET /shap?district=Dhaka` reads `data/shap_values.csv` and returns the top-3 SHAP feature contributions (`label`, `impact`, `log_shap`) with the caveat: *"SHAP অবদান দেখায়, কার্যকারণ প্রমাণ করে না।"*

## 1-Hour Cache & API Protection

- `/predict` and `/top10` use a thread-safe in-memory TTL cache (`3600` seconds / 1 hour), keyed by `(endpoint, district, latest_week)` so repeated requests for the same district and week return instantaneously without recomputation.
- Per-IP sliding-window rate limiting enforces **60 requests/minute per IP** (HTTP `429` when exceeded) alongside structured request logging (`method`, `path`, `status`, latency in ms, and client IP).

## DGHS Daily Scraper, Open-Meteo Weather & Daily Job

- `backend/scraper/dghs_daily.py` fetches DGHS daily dengue bulletin PDFs (`https://old.dghs.gov.bd/images/docs/vpr/YYYYMMDD_dengue_all.pdf`, falling back up to 3 days), parses all 64 districts against `data/districts.csv`, validates `0 < national_total < 5000` and `district_count == 64`, appends to `data/dengue_district_daily_observed.csv`, and updates `data/last_updated.json`.
- `backend/scraper/weather.py` fetches 30-day rainfall and mean temperature for all 64 districts from the free Open-Meteo API into `data/weather_latest.csv` (keeping the last good file if the API fails).
- `backend/jobs/daily_refresh.py` runs daily at **09:00 Asia/Dhaka** (or once via `--once`) to refresh DGHS + weather data and recompute `forecasts_latest.json` when new data arrives.

## CI/CD

- `.github/workflows/test.yml` runs on every push and pull request to `main`, installs `backend/requirements.txt`, and executes `python backend/test_api.py` to verify all endpoints, SHAP outputs, 1-hour cache, rate limiter, and GeoJSON size (`< 500 KB`).

## Run Locally

### 1. Backend (FastAPI)

```powershell
cd backend
uvicorn app:app --reload --port 8000
```

Test backend handlers:

```powershell
python backend/test_api.py
```

### 2. Frontend (Next.js)

```powershell
cd frontend
npm run dev
```

Open `http://localhost:3000`. Even if the backend is stopped, the dashboard loads `public/offline-snapshot.json` for maps, drill-down, charts, SHAP explanations, and Top-10.
