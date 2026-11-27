import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as backend_app


def main() -> None:
    health = backend_app.health()
    assert health["status"] == "ok" and health["districts_count"] == 64
    assert health["precomputed"] is True
    print("HEALTH:", health)

    summary = backend_app.summary()
    assert summary["model_metrics"]["total_districts"] == 64
    assert "data_as_of" in summary
    print("SUMMARY:", summary["latest_week"], summary["national_pred_next_week"], "data_as_of:", summary["data_as_of"])

    districts = backend_app.list_districts()
    assert len(districts) == 64
    print("DISTRICTS:", len(districts))

    # Step 3: verify /predict and /top10 1-hour TTL cache
    backend_app.state.cache.clear()
    dhaka_1 = backend_app.predict("Dhaka")
    assert backend_app.state.cache.size() == 1
    dhaka_2 = backend_app.predict("Dhaka")
    assert dhaka_1 == dhaka_2
    assert dhaka_1["pred_blend"] >= 0
    assert len(dhaka_1["reasons"]) == 3 and "log_shap" in dhaka_1["reasons"][0]
    print("PREDICT Dhaka (cached):", dhaka_1["pred_blend"], dhaka_1["risk_level"])

    shap_dhaka = backend_app.get_shap("Dhaka")
    assert len(shap_dhaka["reasons"]) == 3
    assert abs(shap_dhaka["reasons"][0]["log_shap"] - 2.5213) < 0.05
    print("SHAP Dhaka #1:", shap_dhaka["reasons"][0])

    div = backend_app.get_division("Dhaka")
    assert abs(div["pred_total"] - sum(d["pred_blend"] for d in div["districts"])) < 0.2
    print("DIVISION Dhaka:", div["pred_total"], "districts:", len(div["districts"]))

    top_1 = backend_app.top10()
    assert backend_app.state.cache.size() == 2
    top_2 = backend_app.top10()
    assert top_1 == top_2 and len(top_1) == 10
    print("TOP10 #1 (cached):", top_1[0]["district"], top_1[0]["pred_blend"])

    ts = backend_app.timeseries("Dhaka", "test")
    assert len(ts["points"]) > 40
    print("TIMESERIES Dhaka points:", len(ts["points"]))

    wi = backend_app.whatif("Dhaka", cases_last_week=120, rain_mm_3w_ago=80)
    assert wi["pred_blend"] >= 0
    print("WHATIF Dhaka:", wi["pred_blend"])

    # Step 5: verify rate limiter allows 60/min and blocks 61st, and GeoJSON < 500 KB
    limiter = backend_app.IPRateLimiter(max_requests=60, window_seconds=60)
    for _ in range(60):
        ok, _ = limiter.allow("1.2.3.4")
        assert ok is True
    ok, _ = limiter.allow("1.2.3.4")
    assert ok is False

    geojson_path = Path(__file__).resolve().parent.parent / "frontend" / "public" / "bangladesh-districts.geojson"
    if geojson_path.exists():
        assert geojson_path.stat().st_size < 500 * 1024
        print("GEOJSON size OK:", geojson_path.stat().st_size, "bytes (< 500 KB)")

    print("ALL BACKEND & SCALABILITY CHECKS PASSED!")


if __name__ == "__main__":
    main()
