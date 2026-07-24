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
        ordinary_reciprocal = lattice_result[
            "ordinary_reciprocal_vectors"
        ].reshape(2, 2)
        real_vectors = lattice_result["lattice_vectors"].reshape(2, 2)
        magnetic_vectors = np.vstack((real_vectors[0], 7 * real_vectors[1]))
        zone = lattice_result["bz"].reshape(-1, 2)
        ordinary_zone = lattice_result["ordinary_bz"].reshape(-1, 2)
        groups_7 = unique_groups(bands_7)
        groups_11 = unique_groups(bands_11)

        families.append(
            {
                "lattice": lattice,
                "butterfly_states": int(butterfly["energy"].size),
                "finite_butterfly": bool(np.isfinite(butterfly["energy"]).all()),
                "topology_available": bool(
                    butterfly["topology_available"]
                ),
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
                "ordinary_reciprocal_duality_error": float(
                    np.max(
                        np.abs(
                            real_vectors @ ordinary_reciprocal.T
                            - 2 * np.pi * np.eye(2)
                        )
                    )
                ),
                "brillouin_vertices": int(zone.shape[0] - 1),
                "brillouin_area_error": float(
                    abs(polygon_area(zone) - abs(np.linalg.det(reciprocal)))
                ),
                "ordinary_brillouin_vertices": int(
                    ordinary_zone.shape[0] - 1
                ),
                "ordinary_brillouin_area_error": float(
                    abs(
                        polygon_area(ordinary_zone)
                        - abs(np.linalg.det(ordinary_reciprocal))
                    )
                ),
                "folded_area_ratio_error": float(
                    abs(
                        polygon_area(zone) / polygon_area(ordinary_zone)
                        - 1 / 7
                    )
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

    honeycomb = Hofstadter(0, 1, t=[1.0], lat="honeycomb")
    honeycomb_reciprocal = honeycomb.unit_cell()[3]
    honeycomb_gamma = np.linalg.eigvalsh(
        honeycomb.hamiltonian(np.array([0.0, 0.0]))
    )
    honeycomb_k = np.linalg.eigvalsh(
        honeycomb.hamiltonian(
            np.matmul(np.array([2 / 3, 1 / 3]), honeycomb_reciprocal)
        )
    )
    honeycomb_k_prime = np.linalg.eigvalsh(
        honeycomb.hamiltonian(
            np.matmul(np.array([1 / 3, 2 / 3]), honeycomb_reciprocal)
        )
    )
    honeycomb_parameters = parameters(
        "honeycomb", [1.0], 1, [1, 3], 1.0, q=47
    )
    honeycomb_spectrum = compute_butterfly_batch(
        honeycomb_parameters, 1, 47
    )
    honeycomb_lattice = compute_lattice(honeycomb_parameters)
    honeycomb_sites = honeycomb_lattice["sites"].reshape(-1, 2)
    honeycomb_links = honeycomb_lattice["links"].reshape(-1, 6)
    origin = honeycomb_sites[
        int(np.argmin(np.linalg.norm(honeycomb_sites, axis=1)))
    ]
    origin_neighbors = 0
    for link in honeycomb_links:
        if np.allclose(link[:2], origin, rtol=0, atol=1e-10) or np.allclose(
            link[2:4], origin, rtol=0, atol=1e-10
        ):
            origin_neighbors += 1
    honeycomb_sorted = np.sort(honeycomb_spectrum["energy"])

    diophantine_checks = []
    for numerator, denominator in [(22, 89), (15, 47)]:
        _, hall_integers = chern(numerator, denominator)
        valid = all(
            (gap - numerator * hall_integers[gap]) % denominator == 0
            for gap in range(1, denominator)
        )
        diophantine_checks.append(
            {
                "p": numerator,
                "q": denominator,
                "all_gaps_satisfy_equation": valid,
            }
        )

    result = {
        "status": "pass",
        "analytic_square_dispersion_max_error": analytic_error,
        "honeycomb_invariants": {
            "gamma_eigenvalues": honeycomb_gamma.tolist(),
            "k_eigenvalues": honeycomb_k.tolist(),
            "k_prime_eigenvalues": honeycomb_k_prime.tolist(),
            "bulk_coordination": origin_neighbors,
            "q47_states": int(honeycomb_spectrum["energy"].size),
            "q47_fluxes": int(np.unique(honeycomb_spectrum["flux"]).size),
            "q47_energy_min": float(honeycomb_spectrum["energy"].min()),
            "q47_energy_max": float(honeycomb_spectrum["energy"].max()),
            "q47_chiral_symmetry_error": float(
                np.max(np.abs(honeycomb_sorted + honeycomb_sorted[::-1]))
            ),
        },
        "diophantine_checks": diophantine_checks,
        "families": families,
    }
    failures = []
    if analytic_error > 1e-12:
        failures.append("square analytic dispersion")
    if not np.allclose(honeycomb_gamma, [-3, 3], rtol=0, atol=1e-12):
        failures.append("honeycomb Γ bandwidth")
    if not np.allclose(honeycomb_k, [0, 0], rtol=0, atol=1e-12):
        failures.append("honeycomb K Dirac point")
    if not np.allclose(
        honeycomb_k_prime, [0, 0], rtol=0, atol=1e-12
    ):
        failures.append("honeycomb K-prime Dirac point")
    if origin_neighbors != 3:
        failures.append("honeycomb bulk coordination")
    if (
        honeycomb_spectrum["energy"].min() >= -2.9
        or honeycomb_spectrum["energy"].max() <= 2.9
    ):
        failures.append("honeycomb q47 bandwidth")
    if result["honeycomb_invariants"]["q47_chiral_symmetry_error"] > 1e-10:
        failures.append("honeycomb chiral symmetry")
    if not all(
        check["all_gaps_satisfy_equation"]
        for check in diophantine_checks
    ):
        failures.append("Diophantine gap relation")
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
        if family["ordinary_reciprocal_duality_error"] > 1e-10:
            failures.append(
                f"{family['lattice']} ordinary reciprocal duality"
            )
        if family["brillouin_area_error"] > 1e-10:
            failures.append(f"{family['lattice']} Brillouin-zone area")
        if family["ordinary_brillouin_area_error"] > 1e-10:
            failures.append(
                f"{family['lattice']} ordinary Brillouin-zone area"
            )
        if family["folded_area_ratio_error"] > 1e-10:
            failures.append(f"{family['lattice']} BZ folding ratio")
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
