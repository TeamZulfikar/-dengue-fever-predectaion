# Dengue Outbreak Forecasting Dashboard (64 Districts)

1-week-ahead district dengue forecasting dashboard built with FastAPI + LightGBM (`0.5 * GBM-log(+transfer) + 0.5 * persistence`) and Next.js + React + Tailwind + Leaflet.

## Structure

- `backend/` — FastAPI server (`app.py`), inference feature list (`predict_blend.py`), LightGBM/LSTM models (`model/`), and API tests (`test_api.py`).
- `frontend/` — Next.js App Router dashboard (`src/app/page.tsx`), interactive 64-district Leaflet map (`src/components/BangladeshMap.tsx`), 2025 timeseries chart (`src/components/TimeseriesChart.tsx`), What-if simulator (`src/components/WhatIfSimulator.tsx`), GeoJSON (`public/bangladesh-districts.geojson`), and offline snapshot (`public/offline-snapshot.json`).
- `data/` — `predictions.csv` and `metrics.json`.

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

Open `http://localhost:3000`. Even if the backend is stopped, the dashboard loads `public/offline-snapshot.json` for maps, drill-down, charts, and Top-10; live `uvicorn` on port `8000` enables the What-if simulator.
