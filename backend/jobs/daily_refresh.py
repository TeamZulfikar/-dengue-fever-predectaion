"""
daily_refresh.py — Daily refresh job scheduled at 09:00 Asia/Dhaka.
Runs DGHS daily PDF scraper + Open-Meteo weather fetch, and re-runs
weekly_forecast.py when new data arrives.

Usage:
  python backend/jobs/daily_refresh.py --once   # single run (Render cron / manual)
  python backend/jobs/daily_refresh.py          # local 09:00 Asia/Dhaka loop
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from jobs.weekly_forecast import run_weekly_forecast
from scraper.dghs_daily import run_scraper
from scraper.weather import fetch_all_weather

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("daily-refresh")
DHAKA_TZ = ZoneInfo("Asia/Dhaka")


def run_once() -> None:
    logger.info("Starting daily refresh job (Asia/Dhaka)...")
    got_dghs = run_scraper()
    got_weather = fetch_all_weather()
    if got_dghs or got_weather:
        run_weekly_forecast()
        logger.info("Weekly forecast snapshot refreshed.")
    else:
        logger.warning("No fresh DGHS/weather data; kept existing forecasts_latest.json.")


def seconds_until_next_9am() -> float:
    now = datetime.now(DHAKA_TZ)
    target = now.replace(hour=9, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return (target - now).total_seconds()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Daily 09:00 Asia/Dhaka refresh job")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    args = parser.parse_args()

    if args.once:
        run_once()
    else:
        logger.info("Daily scheduler started (target: 09:00 Asia/Dhaka).")
        while True:
            wait_s = seconds_until_next_9am()
            logger.info("Sleeping %.0f seconds until next 09:00 Asia/Dhaka...", wait_s)
            time.sleep(wait_s)
            run_once()
