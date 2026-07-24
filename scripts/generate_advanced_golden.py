"""Generate the advanced native reference used by the Pyodide parity harness.

This regenerates ``tests/golden/web_advanced_parity.json`` from the native
``HT.web`` adapters so the file has a reproducible provenance.  Like
``generate_golden.py`` it is a native-versus-Pyodide reproducibility anchor,
not independent physics evidence; correctness itself is covered by
``src/HT/tests/test_web_adapter.py`` against the upstream model.
"""

from __future__ import annotations

import json
from pathlib import Path

from HT.web import compute_bands, compute_geometry


PARAMETERS = {
    "lattice": "square",
    "hoppings": [1.0],
    "period": 1,
    "theta": [1, 2],
    "alpha": 1.0,
    "p": 1,
    "q": 4,
    "samples": 7,
    "bgt": 0.01,
    "a": 1,
}

PROBE_INDICES = [0, 1, 8, 24, 48, 97, 147, 195]


def main() -> None:
    bands = compute_bands(PARAMETERS)
    geometry = compute_geometry(PARAMETERS)
    gxx = geometry["gxx"]
    gxy = geometry["gxy"]
    output = {
        "parameters": PARAMETERS,
        "wilson": bands["wilson"].tolist(),
        "geometry_rows": [
            {
                key: row[key]
                for key in (
                    "band",
                    "band_end",
                    "group",
                    "std_g",
                    "av_gxx",
                    "std_gxx",
                    "av_gxy",
                    "std_gxy",
                    "T",
                    "D",
                )
            }
            for row in geometry["rows"]
        ],
        "probe_indices": PROBE_INDICES,
        "gxx": [float(gxx[index]) for index in PROBE_INDICES],
        "gxy": [float(gxy[index]) for index in PROBE_INDICES],
    }
    destination = (
        Path(__file__).parents[1]
        / "tests"
        / "golden"
        / "web_advanced_parity.json"
    )
    destination.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
