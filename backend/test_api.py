import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as backend_app


def main() -> None:
    health = backend_app.health()
    assert health["status"] == "ok" and health["districts_count"] == 64
    print("HEALTH:", health)

    summary = backend_app.summary()
    assert summary["model_metrics"]["total_districts"] == 64
    print("SUMMARY:", summary["latest_week"], summary["national_pred_next_week"])

    districts = backend_app.list_districts()
    assert len(districts) == 64
    print("DISTRICTS:", len(districts))

    dhaka = backend_app.predict("Dhaka")
    assert dhaka["district"] == "Dhaka" and dhaka["pred_blend"] >= 0
    print("PREDICT Dhaka:", dhaka["pred_blend"], dhaka["risk_level"])

    div = backend_app.get_division("Dhaka")
    assert abs(div["pred_total"] - sum(d["pred_blend"] for d in div["districts"])) < 0.2
    print("DIVISION Dhaka:", div["pred_total"], "districts:", len(div["districts"]))

    top = backend_app.top10()
    assert len(top) == 10
    print("TOP10 #1:", top[0])

    ts = backend_app.timeseries("Dhaka", "test")
    assert len(ts["points"]) == 52 or len(ts["points"]) > 40
    print("TIMESERIES Dhaka points:", len(ts["points"]))

    wi = backend_app.whatif("Dhaka", cases_last_week=120, rain_mm_3w_ago=80)
    assert wi["pred_blend"] >= 0
    print("WHATIF Dhaka:", wi["pred_blend"])

    print("ALL BACKEND HANDLERS PASSED!")


if __name__ == "__main__":
    main()
