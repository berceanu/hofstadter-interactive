"""Generate the small native reference used by the Pyodide parity harness."""

from __future__ import annotations

import json
from pathlib import Path

from HT.web import compute_butterfly_batch


CASES = [
    ("square", [1.0], 1, [1, 2]),
    ("triangular", [1.0], 1, [1, 3]),
    ("honeycomb", [1.0], 1, [1, 3]),
    ("kagome", [1.0], 8, [1, 3]),
]


def main() -> None:
    output = []
    for lattice, hoppings, period, theta in CASES:
        parameters = {
            "lattice": lattice,
            "hoppings": hoppings,
            "period": period,
            "theta": theta,
            "alpha": 1.0,
            "p": 1,
            "q": 5,
            "samples": 7,
        }
        result = compute_butterfly_batch(parameters, 1, 5)
        output.append(
            {
                "parameters": parameters,
                "flux": result["flux"].tolist(),
                "energy": result["energy"].tolist(),
                "chern": result["chern"].tolist(),
            }
        )
    destination = Path(__file__).parents[1] / "tests" / "golden" / "web_parity.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
