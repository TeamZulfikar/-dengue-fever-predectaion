"""
dghs_daily.py — DGHS daily dengue bulletin PDF scraper.

Uses ONLY the official DGHS URL pattern:
  https://old.dghs.gov.bd/images/docs/vpr/YYYYMMDD_dengue_all.pdf
Tries today (Asia/Dhaka) first, falling back up to 3 days back if 404.
Matches all 64 districts against data/districts.csv and validates before saving.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import pdfplumber
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("dghs-scraper")

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR.parent / "data"
DISTRICTS_CSV = DATA_DIR / "districts.csv"
DAILY_CSV = DATA_DIR / "dengue_district_daily_observed.csv"
LAST_UPDATED_JSON = DATA_DIR / "last_updated.json"

URL_PATTERN = "https://old.dghs.gov.bd/images/docs/vpr/{ymd}_dengue_all.pdf"
DHAKA_TZ = ZoneInfo("Asia/Dhaka")
BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

# Canonical mapping from DGHS PDF Bengali/Bijoy district strings -> data/districts.csv
PDF_DISTRICT_MAP: dict[str, str] = {
    "ঢাকা": "Dhaka",
    "ঢাকা হানগি": "Dhaka",
    "ফরিদপুি": "Faridpur",
    "ফরিদপুর": "Faridpur",
    "গাজীপুি": "Gazipur",
    "গাজীপুর": "Gazipur",
    "বগাপালগঞ্জ": "Gopalganj",
    "গোপালগঞ্জ": "Gopalganj",
    "রকম ািগঞ্জ": "Kishoreganj",
    "কিশোরগঞ্জ": "Kishoreganj",
    "াদািীপুি": "Madaripur",
    "মাদারীপুর": "Madaripur",
    "ারনকগঞ্জ": "Manikganj",
    "মানিকগঞ্জ": "Manikganj",
    "মুরিরগঞ্জ": "Munshiganj",
    "মুন্সিগঞ্জ": "Munshiganj",
    "নািায়ণগঞ্জ": "Narayanganj",
    "নারায়ণগঞ্জ": "Narayanganj",
    "নিরসিংদী": "Narsingdi",
    "নরসিংদী": "Narsingdi",
    "িাজোড়ী": "Rajbari",
    "রাজবাড়ী": "Rajbari",
    "িীয়তপুি": "Shariatpur",
    "শরীয়তপুর": "Shariatpur",
    "টাঙ্গাইল": "Tangail",
    "য় নরসিংহ": "Mymensingh",
    "ময়মনসিংহ": "Mymensingh",
    "জা ালপুি": "Jamalpur",
    "জামালপুর": "Jamalpur",
    "ব িপুি": "Sherpur",
    "শেরপুর": "Sherpur",
    "বনত্রমকানা": "Netrokona",
    "নেত্রকোণা": "Netrokona",
    "চট্টগ্রা": "Chattogram",
    "চট্টগ্রাম": "Chattogram",
    "কক্সোজাি": "Coxs_Bazar",
    "কক্সবাজার": "Coxs_Bazar",
    "োন্দিোন": "Bandarban",
    "বান্দরবান": "Bandarban",
    "িাঙ্গা াটি": "Rangamati",
    "রাঙ্গামাটি": "Rangamati",
    "খাগড়াছরড়": "Khagrachhari",
    "খাগড়াছড়ি": "Khagrachhari",
    "বফনী": "Feni",
    "ফেনী": "Feni",
    "বনায়াখালী": "Noakhali",
    "নোয়াখালী": "Noakhali",
    "কুর ল্লা": "Cumilla",
    "কুমিল্লা": "Cumilla",
    "চাঁদপুি": "Chandpur",
    "চাঁদপুর": "Chandpur",
    "লক্ষীপুি": "Lakshmipur",
    "লক্ষ্মীপুর": "Lakshmipur",
    "ব্রাহ্মনোরড়য়া": "Brahmanbaria",
    "ব্রাহ্মণবাড়িয়া": "Brahmanbaria",
    "খুলনা": "Khulna",
    "োমগিহাট": "Bagerhat",
    "বাগেরহাট": "Bagerhat",
    "সাতক্ষীিা": "Satkhira",
    "সাতক্ষীরা": "Satkhira",
    "যম াি": "Jashore",
    "যশোর": "Jashore",
    "রিনাইদহ": "Jhenaidah",
    "ঝিনাইদহ": "Jhenaidah",
    "াগুিা": "Magura",
    "মাগুরা": "Magura",
    "নড়াইল": "Narail",
    "কুরিয়া": "Kushtia",
    "কুষ্টিয়া": "Kushtia",
    "চুয়ািাঙ্গা": "Chuadanga",
    "চুয়াডাঙ্গা": "Chuadanga",
    "ব মহিপুি": "Meherpur",
    "মেহেরপুর": "Meherpur",
    "িাজ াহী": "Rajshahi",
    "রাজশাহী": "Rajshahi",
    "চাপাইনোেগঞ্জ": "Chapainawabganj",
    "চাঁপাইনবাবগঞ্জ": "Chapainawabganj",
    "নওগাঁ": "Naogaon",
    "নামটাি": "Natore",
    "নাটোর": "Natore",
    "জয়পুিহাট": "Joypurhat",
    "জয়পুরহাট": "Joypurhat",
    "েগুড়া": "Bogura",
    "বগুড়া": "Bogura",
    "রসিাজগঞ্জ": "Sirajganj",
    "সিরাজগঞ্জ": "Sirajganj",
    "পােনা": "Pabna",
    "পাবনা": "Pabna",
    "িিংপুি": "Rangpur",
    "রংপুর": "Rangpur",
    "লাল রনিহাট": "Lalmonirhat",
    "লালমনিরহাট": "Lalmonirhat",
    "কুরড়গ্রা": "Kurigram",
    "কুড়িগ্রাম": "Kurigram",
    "নীলফা ািী": "Nilphamari",
    "নীলফামারী": "Nilphamari",
    "রদনাজপুি": "Dinajpur",
    "দিনাজপুর": "Dinajpur",
    "গাইোন্ধা": "Gaibandha",
    "গাইবান্ধা": "Gaibandha",
    "ঠাকুিগাঁও": "Thakurgaon",
    "ঠাকুরগাঁও": "Thakurgaon",
    "পঞ্চগড়": "Panchagarh",
    "েরি াল": "Barishal",
    "বরিশাল": "Barishal",
    "পটুয়াখালী": "Patuakhali",
    "বভালা": "Bhola",
    "ভোলা": "Bhola",
    "রপমিাজপুি": "Pirojpur",
    "পিরোজপুর": "Pirojpur",
    "েিগুনা": "Barguna",
    "বরগুনা": "Barguna",
    "িালকাঠি": "Jhalokathi",
    "ঝালকাঠি": "Jhalokathi",
    "রসমলট": "Sylhet",
    "সিলেট": "Sylhet",
    "সুনা গঞ্জ": "Sunamganj",
    "সুনামগঞ্জ": "Sunamganj",
    "হরেগঞ্জ": "Habiganj",
    "হবিগঞ্জ": "Habiganj",
    "ব ৌলভীোজাি": "Moulvibazar",
    "মৌলভীবাজার": "Moulvibazar",
}


def _to_int(val: Any) -> int:
    if val is None:
        return 0
    s = str(val).translate(BN_DIGITS).replace(",", "").strip()
    m = re.search(r"-?\d+", s)
    return int(m.group(0)) if m else 0


def parse_dghs_pdf(pdf_path: Path, report_date: str) -> tuple[pd.DataFrame, list[str]]:
    """
    Parse district-level 24h cases & cumulative cases/deaths from a DGHS daily PDF.
    Returns (DataFrame of 64 districts, list of unmatched district strings).
    """
    districts_meta = pd.read_csv(DISTRICTS_CSV)
    div_lookup = dict(zip(districts_meta["district"], districts_meta["division"]))
    valid_districts = set(div_lookup.keys())

    agg: dict[str, dict[str, int]] = {
        d: {"new_cases": 0, "cumulative_cases": 0, "cumulative_deaths": 0}
        for d in valid_districts
    }
    unmatched: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row or len(row) < 9:
                        continue
                    c0 = (row[0] or "").strip()
                    c1 = (row[1] or "").translate(BN_DIGITS).strip()
                    c2 = (row[2] or "").strip()

                    # Skip header and district/division subtotal rows
                    if "বজলাি" in c1 or "মোট" in c1 or "রেভাগ" in c1 or "বিভাগ" in c1:
                        continue

                    raw_dist = None
                    if "ঢাকা হানগি" in c0 or "ঢাকা মহানগর" in c0:
                        raw_dist = "ঢাকা হানগি"
                    elif c2 and (c1.isdigit() or c2 in PDF_DISTRICT_MAP):
                        raw_dist = c2

                    if not raw_dist:
                        continue

                    canonical = PDF_DISTRICT_MAP.get(raw_dist)
                    if not canonical:
                        if raw_dist not in unmatched:
                            unmatched.append(raw_dist)
                        continue

                    # Column 6: 24h new admissions total; Column 7: cumulative cases; Column 8: cumulative deaths
                    new_cases = _to_int(row[6])
                    cum_cases = _to_int(row[7])
                    cum_deaths = _to_int(row[8])

                    agg[canonical]["new_cases"] += new_cases
                    agg[canonical]["cumulative_cases"] += cum_cases
                    agg[canonical]["cumulative_deaths"] += cum_deaths

    records = [
        {
            "district": d,
            "division": div_lookup[d],
            "date": report_date,
            "new_cases": agg[d]["new_cases"],
            "new_deaths": pd.NA,
            "cumulative_cases": agg[d]["cumulative_cases"],
            "cumulative_deaths": agg[d]["cumulative_deaths"],
            "source_pdf": pdf_path.name,
        }
        for d in sorted(valid_districts)
    ]
    return pd.DataFrame(records), unmatched


def validate_parsed(df: pd.DataFrame, unmatched: list[str]) -> tuple[bool, str]:
    if unmatched:
        return False, f"Unmatched district names in PDF: {unmatched}"
    if len(df) != 64:
        return False, f"Expected 64 districts, got {len(df)}"
    total = int(df["new_cases"].sum())
    if total <= 0 or total >= 5000:
        return False, f"National daily total {total} out of valid range (1..4999)"
    return True, f"Valid: 64 districts, national_new_cases={total}"


def fetch_latest_dghs_pdf(max_days_back: int = 3) -> tuple[Path | None, str | None]:
    now_dhaka = datetime.now(DHAKA_TZ).date()
    for offset in range(max_days_back + 1):
        target_date = now_dhaka - timedelta(days=offset)
        ymd = target_date.strftime("%Y%m%d")
        url = URL_PATTERN.format(ymd=ymd)
        try:
            resp = requests.get(url, timeout=20)
            if resp.status_code == 200 and resp.content.startswith(b"%PDF"):
                tmp = Path(tempfile.gettempdir()) / f"{ymd}_dengue_all.pdf"
                tmp.write_bytes(resp.content)
                logger.info("Downloaded DGHS PDF: %s", url)
                return tmp, target_date.strftime("%Y-%m-%d")
            logger.warning("DGHS PDF unavailable (%s): HTTP %s", url, resp.status_code)
        except Exception as exc:
            logger.warning("DGHS PDF fetch failed (%s): %s", url, exc)
    return None, None


def run_scraper(test_pdf: Path | None = None, report_date: str | None = None, dry_run: bool = False) -> bool:
    if test_pdf is not None:
        pdf_path = test_pdf
        date_str = report_date or "2026-11-15"
    else:
        pdf_path, date_str = fetch_latest_dghs_pdf(max_days_back=3)
        if not pdf_path or not date_str:
            logger.error("No DGHS PDF found in the last 3 days; keeping existing data.")
            return False

    df_new, unmatched = parse_dghs_pdf(pdf_path, date_str)
    ok, msg = validate_parsed(df_new, unmatched)
    if not ok:
        logger.error("Validation failed (%s) — keeping yesterday's data.", msg)
        return False

    logger.info("Validation passed: %s", msg)
    if dry_run:
        return True

    if DAILY_CSV.exists():
        existing = pd.read_csv(DAILY_CSV)
        existing = existing[existing["date"] != date_str]
        combined = pd.concat([existing, df_new], ignore_index=True)
    else:
        combined = df_new

    combined.to_csv(DAILY_CSV, index=False)
    national_total = int(df_new["new_cases"].sum())
    LAST_UPDATED_JSON.write_text(
        json.dumps(
            {
                "date": date_str,
                "source": "DGHS daily bulletin PDF",
                "national_new_cases": national_total,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    logger.info("Updated %s and %s (date=%s, total=%d)", DAILY_CSV.name, LAST_UPDATED_JSON.name, date_str, national_total)
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DGHS daily dengue PDF scraper")
    parser.add_argument("--test-pdf", type=Path, default=None, help="Path to local sample PDF")
    parser.add_argument("--date", type=str, default=None, help="YYYY-MM-DD date for --test-pdf")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate without writing CSV")
    args = parser.parse_args()

    if args.test_pdf:
        df_parsed, unmatched_list = parse_dghs_pdf(args.test_pdf, args.date or "2026-11-15")
        valid, info = validate_parsed(df_parsed, unmatched_list)
        print("Validation:", valid, info)
        print("Sample 3 districts:")
        print(
            df_parsed[df_parsed["district"].isin(["Dhaka", "Chattogram", "Rangpur"])][
                ["district", "division", "date", "new_cases", "cumulative_cases", "cumulative_deaths"]
            ].to_string(index=False)
        )
    else:
        run_scraper(dry_run=args.dry_run)
