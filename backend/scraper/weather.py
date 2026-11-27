"""
weather.py — Fetches 30-day daily rainfall and mean temperature for all 64 districts
from the free Open-Meteo API using coordinates from data/districts.csv.
Saves to data/weather_latest.csv; keeps last good file if API fails.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("open-meteo")

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR.parent / "data"
DISTRICTS_CSV = DATA_DIR / "districts.csv"
WEATHER_CSV = DATA_DIR / "weather_latest.csv"

OPEN_METEO_URL = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lat}&longitude={lon}"
    "&daily=precipitation_sum,temperature_2m_mean"
    "&timezone=Asia%2FDhaka&past_days=30"
)


def fetch_all_weather() -> bool:
    if not DISTRICTS_CSV.exists():
        logger.error("Missing %s", DISTRICTS_CSV)
        return False

    districts_df = pd.read_csv(DISTRICTS_CSV)
    rows: list[dict[str, object]] = []
    failed: list[str] = []

    for rec in districts_df.itertuples(index=False):
        url = OPEN_METEO_URL.format(lat=rec.latitude, lon=rec.longitude)
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            daily = resp.json().get("daily", {})
            dates = daily.get("time", [])
            rain = daily.get("precipitation_sum", [])
            tmean = daily.get("temperature_2m_mean", [])
            for dt, r_val, t_val in zip(dates, rain, tmean):
                rows.append(
                    {
                        "district": rec.district,
                        "division": rec.division,
                        "date": dt,
                        "precipitation_sum": r_val,
                        "temperature_2m_mean": t_val,
                    }
                )
        except Exception as exc:
            failed.append(str(rec.district))
            logger.warning("Open-Meteo failed for %s: %s", rec.district, exc)

    if len(rows) == 0:
        logger.error("Open-Meteo returned 0 rows; keeping previous %s", WEATHER_CSV.name)
        return False

    out_df = pd.DataFrame(rows)
    out_df.to_csv(WEATHER_CSV, index=False)
    logger.info(
        "Saved %d weather rows (%d failed districts) -> %s",
        len(out_df),
        len(failed),
        WEATHER_CSV.name,
    )
    return True


if __name__ == "__main__":
    fetch_all_weather()
