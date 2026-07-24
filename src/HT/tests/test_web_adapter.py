"""Parity coverage for the pure browser computation entry points."""

from math import gcd

import numpy as np
import pytest

from HT.functions.butterfly import chern
from HT.models.hofstadter import Hofstadter
from HT.web import compute_bands, compute_butterfly_batch, compute_lattice


CASES = [
    ("square", [1.0], 1, [1, 2]),
    ("triangular", [1.0], 1, [1, 3]),
    ("honeycomb", [1.0], 1, [1, 3]),
    ("kagome", [1.0], 8, [1, 3]),
    ("bravais", [0.5, 0.2], 1, [67, 180]),
]


@pytest.mark.parametrize("lattice,hoppings,period,theta", CASES)
def test_butterfly_adapter_matches_model(lattice, hoppings, period, theta):
    parameters = {
        "lattice": lattice,
        "hoppings": hoppings,
        "period": period,
        "theta": theta,
        "alpha": 1.0,
        "q": 7,
    }
    result = compute_butterfly_batch(parameters, 1, 7)
    reference_flux = []
    reference_energy = []
    reference_chern = []
    for p in range(1, 7):
        if gcd(p, 7) != 1:
            continue
        model = Hofstadter(
            p,
            7,
            t=hoppings,
            lat=lattice,
            alpha=1.0,
            theta=tuple(theta),
            period=period,
        )
        energies = np.sort(np.linalg.eigvalsh(model.hamiltonian(np.array([0, 0]))))
        reference_flux.extend([p / 7] * len(energies))
        reference_energy.extend(energies)
        base, _ = chern(p, 7)
        if len(energies) == 7:
            reference_chern.extend(base)
        elif len(energies) == 14 and len(hoppings) == 1:
            reference_chern.extend(base + list(reversed(base)))
        else:
            reference_chern.extend([0] * len(energies))
    assert np.allclose(result["flux"], reference_flux, rtol=0, atol=0)
    assert np.allclose(result["energy"], reference_energy, rtol=1e-9, atol=1e-11)
    assert np.array_equal(result["chern"], reference_chern)
    assert np.isfinite(result["energy"]).all()


def test_band_and_lattice_contracts_are_finite():
    parameters = {
        "lattice": "square",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 2],
        "alpha": 1.0,
        "p": 1,
        "q": 3,
        "samples": 7,
    }
    bands = compute_bands(parameters)
    lattice = compute_lattice(parameters)
    assert bands["energy"].shape == (3 * 7 * 7,)
    assert bands["berry"].shape == bands["energy"].shape
    assert np.isfinite(bands["energy"]).all()
    assert bands["chern"].shape == (3,)
    assert bands["group_start"].shape == (3,)
    assert bands["group_size"].shape == (3,)
    assert lattice["sites"].size > 0
    assert lattice["bz"].ndim == 1
    assert lattice["bz"].size >= 10
    assert lattice["bz"].size % 2 == 0


@pytest.mark.parametrize("lattice,hoppings,period,theta", CASES)
def test_brillouin_zone_is_the_reciprocal_wigner_seitz_cell(
    lattice, hoppings, period, theta
):
    parameters = {
        "lattice": lattice,
        "hoppings": hoppings,
        "period": period,
        "theta": theta,
        "alpha": 1.0,
        "p": 1,
        "q": 11,
    }
    result = compute_lattice(parameters)
    vertices = result["bz"].reshape(-1, 2)
    reciprocal = result["reciprocal_vectors"].reshape(2, 2)
    lattice_vectors = result["lattice_vectors"].reshape(2, 2)
    magnetic_vectors = np.vstack(
        (lattice_vectors[0], parameters["q"] * lattice_vectors[1])
    )

    assert np.allclose(vertices[0], vertices[-1], rtol=0, atol=1e-10)
    assert np.allclose(
        magnetic_vectors @ reciprocal.T,
        2 * np.pi * np.eye(2),
        rtol=1e-10,
        atol=1e-10,
    )
    polygon = vertices[:-1]
    area = 0.5 * abs(
        np.dot(polygon[:, 0], np.roll(polygon[:, 1], -1))
        - np.dot(polygon[:, 1], np.roll(polygon[:, 0], -1))
    )
    assert np.isclose(
        area,
        abs(np.linalg.det(reciprocal)),
        rtol=1e-10,
        atol=1e-10,
    )


@pytest.mark.parametrize(
    "lattice,period,expected_groups",
    [
        ("honeycomb", 1, [(0, 1), (1, 1), (2, 2), (4, 1), (5, 1)]),
        ("kagome", 8, [(0, 1), (1, 1), (2, 3), (5, 1), (6, 2), (8, 1)]),
    ],
)
def test_touching_bands_use_gauge_invariant_group_cherns(
    lattice, period, expected_groups
):
    result = compute_bands(
        {
            "lattice": lattice,
            "hoppings": [1.0],
            "period": period,
            "theta": [1, 3],
            "alpha": 1.0,
            "p": 1,
            "q": 3,
            "samples": 7,
        }
    )
    groups = []
    for start, size in zip(result["group_start"], result["group_size"]):
        pair = (int(start), int(size))
        if pair not in groups:
            groups.append(pair)
        assert np.all(
            result["chern"][start : start + size] == result["chern"][start]
        )
    assert groups == expected_groups
    assert sum(result["chern"][start] for start, _ in groups) == 0
