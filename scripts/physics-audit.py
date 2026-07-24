"""Generate numerical invariants used by the interactive-app audit report."""

from __future__ import annotations

import json
from math import gcd
from pathlib import Path

import numpy as np

from HT.functions.butterfly import chern
from HT.models.hofstadter import Hofstadter
from HT.web import compute_bands, compute_butterfly_batch, compute_lattice


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "audit" / "physics-results.json"
CASES = [
    ("square", [1.0], 1, [1, 2], 1.0),
    ("triangular", [1.0], 1, [1, 3], 1.0),
    ("honeycomb", [1.0], 1, [1, 3], 1.0),
    ("kagome", [1.0], 8, [1, 3], 1.0),
    ("bravais", [0.5, 0.2], 1, [67, 180], 1.4),
]


def parameters(
    lattice: str,
    hoppings: list[float],
    period: int,
    theta: list[int],
    alpha: float,
    *,
    q: int = 7,
    samples: int = 7,
) -> dict[str, object]:
    return {
        "lattice": lattice,
        "hoppings": hoppings,
        "period": period,
        "theta": theta,
        "alpha": alpha,
        "p": 1,
        "q": q,
        "samples": samples,
    }


def unique_groups(result: dict[str, object]) -> list[tuple[int, int, int]]:
    starts = result["group_start"]
    sizes = result["group_size"]
    cherns = result["chern"]
    groups = []
    for start, size in zip(starts, sizes):
        value = (int(start), int(size), int(cherns[start]))
        if value not in groups:
            groups.append(value)
    return groups


def polygon_area(vertices: np.ndarray) -> float:
    polygon = vertices[:-1]
    return 0.5 * abs(
        np.dot(polygon[:, 0], np.roll(polygon[:, 1], -1))
        - np.dot(polygon[:, 1], np.roll(polygon[:, 0], -1))
    )


def main() -> None:
    families = []
    for lattice, hoppings, period, theta, alpha in CASES:
        values = parameters(lattice, hoppings, period, theta, alpha)
        butterfly = compute_butterfly_batch(values, 1, 7)
        reference_energy = []
        reference_chern = []
        for numerator in range(1, 7):
            if gcd(numerator, 7) != 1:
                continue
            model = Hofstadter(
                numerator,
                7,
                t=hoppings,
                lat=lattice,
                alpha=alpha,
                theta=tuple(theta),
                period=period,
            )
            energy = np.sort(
                np.linalg.eigvalsh(model.hamiltonian(np.array([0.0, 0.0])))
            )
            reference_energy.extend(energy)
            base, _ = chern(numerator, 7)
            if energy.size == 7:
                reference_chern.extend(base)
            elif energy.size == 14 and len(hoppings) == 1:
                reference_chern.extend(base + list(reversed(base)))
            else:
                reference_chern.extend([0] * energy.size)

        bands_7 = compute_bands(
            parameters(
                lattice,
                hoppings,
                period,
                theta,
                alpha,
                q=3,
                samples=7,
            )
        )
        bands_11 = compute_bands(
            parameters(
                lattice,
                hoppings,
                period,
                theta,
                alpha,
                q=3,
                samples=11,
            )
        )
        lattice_result = compute_lattice(values)
        reciprocal = lattice_result["reciprocal_vectors"].reshape(2, 2)
        real_vectors = lattice_result["lattice_vectors"].reshape(2, 2)
        magnetic_vectors = np.vstack((real_vectors[0], 7 * real_vectors[1]))
        zone = lattice_result["bz"].reshape(-1, 2)
        groups_7 = unique_groups(bands_7)
        groups_11 = unique_groups(bands_11)

        families.append(
            {
                "lattice": lattice,
                "butterfly_states": int(butterfly["energy"].size),
                "finite_butterfly": bool(np.isfinite(butterfly["energy"]).all()),
                "adapter_max_energy_error": float(
                    np.max(
                        np.abs(
                            butterfly["energy"]
                            - np.asarray(reference_energy, dtype=np.float64)
                        )
                    )
                ),
                "adapter_chern_exact": bool(
                    np.array_equal(
                        butterfly["chern"],
                        np.asarray(reference_chern, dtype=np.int32),
                    )
                ),
                "band_grid_shape": list(
                    bands_7["energy"].reshape(
                        bands_7["bands"],
                        bands_7["samples"],
                        bands_7["samples"],
                    ).shape
                ),
                "finite_energy_and_berry": bool(
                    np.isfinite(bands_7["energy"]).all()
                    and np.isfinite(bands_7["berry"]).all()
                ),
                "topological_groups": groups_7,
                "group_cherns_stable_7_to_11": groups_7 == groups_11,
                "complete_bundle_chern": int(
                    sum(group[2] for group in groups_7)
                ),
                "reciprocal_duality_error": float(
                    np.max(
                        np.abs(
                            magnetic_vectors @ reciprocal.T
                            - 2 * np.pi * np.eye(2)
                        )
                    )
                ),
                "brillouin_vertices": int(zone.shape[0] - 1),
                "brillouin_area_error": float(
                    abs(polygon_area(zone) - abs(np.linalg.det(reciprocal)))
                ),
            }
        )

    square = Hofstadter(0, 1, t=[1.0], lat="square")
    sample_momenta = [
        np.array([0.0, 0.0]),
        np.array([np.pi, 0.0]),
        np.array([np.pi, np.pi]),
        np.array([0.3, 0.7]),
    ]
    analytic_error = max(
        abs(
            float(np.real(square.hamiltonian(momentum)[0, 0]))
            + 2 * (np.cos(momentum[0]) + np.cos(momentum[1]))
        )
        for momentum in sample_momenta
    )

    result = {
        "status": "pass",
        "analytic_square_dispersion_max_error": analytic_error,
        "families": families,
    }
    failures = []
    if analytic_error > 1e-12:
        failures.append("square analytic dispersion")
    for family in families:
        if not family["finite_butterfly"]:
            failures.append(f"{family['lattice']} butterfly finite")
        if family["adapter_max_energy_error"] > 1e-10:
            failures.append(f"{family['lattice']} adapter energy parity")
        if not family["adapter_chern_exact"]:
            failures.append(f"{family['lattice']} adapter Chern parity")
        if not family["finite_energy_and_berry"]:
            failures.append(f"{family['lattice']} band finiteness")
        if not family["group_cherns_stable_7_to_11"]:
            failures.append(f"{family['lattice']} grouped Chern convergence")
        if family["complete_bundle_chern"] != 0:
            failures.append(f"{family['lattice']} complete-bundle Chern")
        if family["reciprocal_duality_error"] > 1e-10:
            failures.append(f"{family['lattice']} reciprocal duality")
        if family["brillouin_area_error"] > 1e-10:
            failures.append(f"{family['lattice']} Brillouin-zone area")
    if failures:
        result["status"] = "fail"
        result["failures"] = failures

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Physics audit {result['status']}: {OUTPUT}")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
