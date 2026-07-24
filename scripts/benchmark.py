"""Measure the post-initialization native reference workload."""

from __future__ import annotations

import json
import platform
import time
from pathlib import Path

from HT.web import compute_butterfly_batch


def main() -> None:
    parameters = {
        "lattice": "square",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 2],
        "alpha": 1.0,
        "p": 1,
        "q": 97,
        "samples": 17,
    }
    started = time.perf_counter()
    result = compute_butterfly_batch(parameters, 1, 97)
    elapsed = time.perf_counter() - started
    destination = Path(__file__).parents[1] / "BENCHMARK.json"
    existing = (
        json.loads(destination.read_text()) if destination.exists() else {}
    )
    report = {
        **existing,
        "date": time.strftime("%Y-%m-%d"),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "workload": "square q=97 butterfly",
        "points": int(result["energy"].size),
        "native_seconds": round(elapsed, 4),
        "browser_target_seconds": 10,
        "note": "Native timing is a reference; browser timing is shown in the application UI.",
    }
    destination.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
