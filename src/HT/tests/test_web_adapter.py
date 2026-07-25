"""Parity coverage for the pure browser computation entry points."""

from math import gcd

import numpy as np
import pytest

from HT.functions.butterfly import chern
from HT.functions.band_structure import geom_tensor
from HT.models.hofstadter import Hofstadter
from HT.web import (
    compute_bands,
    compute_butterfly_batch,
    compute_dispersion,
    compute_geometry,
    compute_lattice,
    compute_topology,
)


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
        if lattice == "square" and len(hoppings) == 1 and len(energies) == 7:
            reference_chern.extend(base)
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
    assert bands["wilson"].shape == (3 * 7,)
    assert np.isfinite(bands["energy"]).all()
    assert bands["chern"].shape == (3,)
    assert bands["topology_resolved"]
    assert bands["topology_group_resolved"].shape == (3,)
    assert bands["wilson_winding"].shape == (3,)
    assert bands["wilson_max_step"].shape == (3,)
    assert bands["topology_total_chern"] == 0
    assert bands["topology_total_winding"] == 0
    assert bands["group_start"].shape == (3,)
    assert bands["group_size"].shape == (3,)
    assert bands["path_k1"].shape == bands["path_x"].shape
    assert bands["path_k2"].shape == bands["path_x"].shape
    assert bands["bz"].size >= 10
    assert bands["ordinary_bz"].size >= 10
    assert [point["label"] for point in bands["sym_points"]] == [
        "Γ",
        "X",
        "M",
        "Y",
    ]
    assert lattice["sites"].size > 0
    assert lattice["bz"].ndim == 1
    assert lattice["bz"].size >= 10
    assert lattice["bz"].size % 2 == 0
    assert lattice["ordinary_bz"].size >= 10
    assert lattice["ordinary_reciprocal_vectors"].shape == (4,)
    assert lattice["sym_points"] == bands["sym_points"]
    assert np.array_equal(lattice["bz"], bands["bz"])
    assert np.array_equal(lattice["ordinary_bz"], bands["ordinary_bz"])


@pytest.mark.parametrize("q", [3, 4, 5])
def test_square_wilson_winding_matches_diophantine_chern(q):
    samples = 31
    result = compute_bands(
        {
            "lattice": "square",
            "hoppings": [1.0],
            "period": 1,
            "theta": [1, 2],
            "alpha": 1.0,
            "p": 1,
            "q": q,
            "samples": samples,
        }
    )
    loops = result["wilson"].reshape(q, samples)
    unwrapped = np.unwrap(loops, axis=1)
    # The magnetic reciprocal basis traverses k₂ with the orientation opposite
    # to the Berry plaquette boundary, hence C is minus the plotted phase rise.
    winding = np.rint(
        (unwrapped[:, 0] - unwrapped[:, -1]) / (2 * np.pi)
    ).astype(int)
    diophantine, _ = chern(1, q)

    isolated = result["group_size"] == 1
    assert np.array_equal(winding[isolated], np.asarray(diophantine)[isolated])

    group_starts = np.flatnonzero(
        result["group_start"] == np.arange(result["group_start"].size)
    )
    assert int(np.sum(winding[group_starts])) == 0


def test_square_q31_guard_refines_the_selected_group_only():
    parameters = {
        "lattice": "square",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 2],
        "alpha": 1.0,
        "p": 1,
        "q": 31,
        "samples": 31,
        "bgt": 0.01,
    }
    base = compute_bands(parameters)
    assert not base["topology_resolved"]
    assert (
        base["topology_total_chern"] != 0
        or base["topology_total_winding"] != 0
        or not np.all(base["topology_group_resolved"])
    )
    assert not base["topology_group_resolved"][15]

    selected = 15
    group_start = int(base["group_start"][selected])
    group_size = int(base["group_size"][group_start])
    refined = compute_topology(
        {
            **parameters,
            "topology_groups": [[group_start, group_size]],
            "topology_partial": True,
            "topology_samples_x": 81,
            "topology_samples_y": 179,
        }
    )
    expected_chern, _ = chern(1, 31)

    assert refined["samples_x"] == 81
    assert refined["samples_y"] == 179
    assert refined["topology_resolved"]
    assert refined["topology_grouping_consistent"]
    assert refined["topology_total_chern"] == expected_chern[group_start]
    assert refined["topology_total_winding"] == expected_chern[group_start]
    assert np.count_nonzero(refined["topology_group_resolved"]) == group_size
    assert refined["chern"][group_start] == expected_chern[group_start]
    assert (
        refined["wilson_winding"][group_start]
        == expected_chern[group_start]
    )
    assert (
        refined["wilson_max_step"][group_start]
        < refined["wilson_phase_step_limit"]
    )


def test_square_q31_dispersion_refinement_resolves_symmetry_path_aliasing():
    parameters = {
        "lattice": "square",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 2],
        "alpha": 1.0,
        "p": 1,
        "q": 31,
        "samples": 17,
        "bgt": 0.01,
    }
    base = compute_bands(parameters)
    refined = compute_dispersion(
        {
            **parameters,
            "dispersion_surface_samples": 125,
            "dispersion_path_samples": 124,
        }
    )

    assert refined["base_samples"] == 17
    assert refined["surface_samples"] == 125
    assert refined["path_samples_per_segment"] == 124
    assert refined["energy"].shape == (31 * 125 * 125,)
    assert refined["path_x"].shape == (4 * 124 + 1,)
    assert refined["path_k1"].shape == refined["path_x"].shape
    assert refined["path_k2"].shape == refined["path_x"].shape
    assert refined["path_energy"].shape == (31 * (4 * 124 + 1),)
    assert np.isfinite(refined["energy"]).all()
    assert np.isfinite(refined["path_energy"]).all()

    base_path = base["path_energy"].reshape(31, -1)[14]
    refined_path = refined["path_energy"].reshape(31, -1)[14]
    base_segment_samples = base["path_x"].size // 4
    refined_segment_samples = refined["path_x"].size // 4
    base_edge = base_path[
        2 * base_segment_samples : 3 * base_segment_samples
    ]
    refined_edge = refined_path[
        2 * refined_segment_samples : 3 * refined_segment_samples
    ]
    assert np.max(np.abs(np.diff(refined_edge))) < (
        0.5 * np.max(np.abs(np.diff(base_edge)))
    )

    surface = refined["energy"].reshape(31, 125, 125)
    assert np.allclose(surface[:, 0], surface[:, -1], rtol=1e-9, atol=1e-11)
    assert np.allclose(
        surface[:, :, 0],
        surface[:, :, -1],
        rtol=1e-9,
        atol=1e-11,
    )

    probe = 2 * refined_segment_samples + 37
    model = Hofstadter(
        1,
        31,
        t=[1.0],
        lat="square",
        alpha=1.0,
        theta=(1, 2),
        period=1,
    )
    reciprocal = model.unit_cell()[3]
    momentum = np.matmul(
        np.array([refined["path_k1"][probe], refined["path_k2"][probe]]),
        reciprocal,
    )
    reference = np.sort(np.linalg.eigvalsh(model.hamiltonian(momentum)))
    assert np.allclose(
        refined["path_energy"].reshape(31, -1)[:, probe],
        reference,
        rtol=1e-9,
        atol=1e-11,
    )


def test_band_property_rows_match_upstream_cli_definitions():
    samples = 11
    result = compute_bands(
        {
            "lattice": "square",
            "hoppings": [1.0],
            "period": 1,
            "theta": [1, 2],
            "alpha": 1.0,
            "p": 1,
            "q": 4,
            "samples": samples,
            "bgt": 0.01,
        }
    )
    values = result["energy"].reshape(4, samples, samples)
    berry = result["berry"].reshape(4, samples, samples)
    widths = np.max(values, axis=(1, 2)) - np.min(values, axis=(1, 2))
    gaps = np.full(4, np.nan)
    gaps[:-1] = (
        np.min(values[1:], axis=(1, 2))
        - np.max(values[:-1], axis=(1, 2))
    )

    assert [row["band"] for row in result["property_rows"]] == [3, 2, 1, 0]
    for row in result["property_rows"]:
        band = row["band"]
        assert np.isclose(row["width"], widths[band], rtol=0, atol=1e-12)
        if band == 3:
            assert row["gap"] is None
            assert row["gap_width"] is None
        else:
            assert np.isclose(row["gap"], gaps[band], rtol=0, atol=1e-12)
            assert np.isclose(
                row["gap_width"],
                gaps[band] / widths[band],
                rtol=0,
                atol=1e-12,
            )
        group_flux = berry[band, :-1, :-1]
        expected_std = np.std(group_flux) / np.abs(np.average(group_flux))
        assert np.isclose(row["std_B"], expected_std, rtol=1e-12, atol=1e-12)
        assert row["C"] == result["chern"][band]

    assert len(result["group_rows"]) == 3
    assert result["group_rows"][1]["band"] == 1
    assert result["group_rows"][1]["band_end"] == 2
    assert result["group_rows"][1]["isolated"] is False

    merged = compute_bands(
        {
            "lattice": "square",
            "hoppings": [1.0],
            "period": 1,
            "theta": [1, 2],
            "alpha": 1.0,
            "p": 1,
            "q": 4,
            "samples": 7,
            "bgt": 10.0,
        }
    )
    assert len(merged["group_rows"]) == 1


def test_square_q4_geometry_matches_upstream_tensor_statistics():
    samples = 7
    parameters = {
        "lattice": "square",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 2],
        "alpha": 1.0,
        "p": 1,
        "q": 4,
        "samples": samples,
        "bgt": 0.01,
    }
    result = compute_geometry(parameters)
    model = Hofstadter(1, 4, t=[1.0], lat="square", theta=(1, 2))
    band_count, _, _, reciprocal, _ = model.unit_cell()
    vectors = np.empty(
        (band_count, band_count, samples, samples), dtype=np.complex128
    )
    vectors_dkx = np.empty_like(vectors)
    vectors_dky = np.empty_like(vectors)
    offset = 1 / (1000 * (samples - 1))
    for ix, frac_x in enumerate(np.linspace(0, 1, samples)):
        for iy, frac_y in enumerate(np.linspace(0, 1, samples)):
            momenta = [
                np.matmul([frac_x, frac_y], reciprocal),
                np.matmul([(frac_x + offset) % 1, frac_y], reciprocal),
                np.matmul([frac_x, (frac_y + offset) % 1], reciprocal),
            ]
            destinations = [vectors, vectors_dkx, vectors_dky]
            for momentum, destination in zip(momenta, destinations):
                eigvals, eigvecs = np.linalg.eigh(model.hamiltonian(momentum))
                destination[:, :, ix, iy] = eigvecs[:, np.argsort(eigvals)]

    delta_kx = np.dot([1 / (samples - 1), 0], reciprocal[0])
    delta_ky = np.dot([0, 1 / (samples - 1)], reciprocal[1])
    gxx = result["gxx"].reshape(band_count, samples, samples)
    gxy = result["gxy"].reshape(band_count, samples, samples)
    for row in result["rows"]:
        start = row["band"]
        size = row["band_end"] - start + 1
        metric = np.empty((samples - 1, samples - 1, 2, 2))
        tism = np.empty((samples - 1, samples - 1))
        dism = np.empty_like(tism)
        for ix in range(samples - 1):
            for iy in range(samples - 1):
                tensor = geom_tensor(
                    vectors,
                    vectors_dkx,
                    vectors_dky,
                    reciprocal,
                    start,
                    ix,
                    iy,
                    size,
                )
                metric[ix, iy] = np.real(tensor)
                berry_xy = (-2 * np.imag(tensor))[0, 1]
                tism[ix, iy] = np.trace(metric[ix, iy]) - abs(berry_xy)
                dism[ix, iy] = (
                    np.linalg.det(metric[ix, iy]) - 0.25 * abs(berry_xy) ** 2
                )

        expected = {
            "std_g": np.sqrt(np.var(metric[0, 0]) + np.var(metric[0, 1])),
            "av_gxx": np.mean(metric[:, :, 0, 0]),
            "std_gxx": np.std(metric[:, :, 0, 0]),
            "av_gxy": np.mean(metric[:, :, 0, 1]),
            "std_gxy": np.std(metric[:, :, 0, 1]),
            "T": np.sum(tism) * delta_kx * delta_ky / (2 * np.pi),
            "D": np.sum(dism) * delta_kx * delta_ky / (2 * np.pi),
        }
        for key, value in expected.items():
            assert np.isclose(row[key], value, rtol=1e-6, atol=1e-9)
        assert np.allclose(
            gxx[start, :-1, :-1], metric[:, :, 0, 0], rtol=1e-6, atol=1e-9
        )
        assert np.allclose(
            gxy[start, :-1, :-1], metric[:, :, 0, 1], rtol=1e-6, atol=1e-9
        )


def test_honeycomb_has_threefold_coordination_and_graphene_limits():
    model = Hofstadter(0, 1, lat="honeycomb")
    reciprocal = model.unit_cell()[3]
    gamma = np.linalg.eigvalsh(model.hamiltonian(np.array([0.0, 0.0])))
    corner = np.linalg.eigvalsh(
        model.hamiltonian(np.matmul(np.array([2 / 3, 1 / 3]), reciprocal))
    )
    assert np.allclose(gamma, [-3.0, 3.0], rtol=0, atol=1e-12)
    assert np.allclose(corner, [0.0, 0.0], rtol=0, atol=1e-12)

    parameters = {
        "lattice": "honeycomb",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 3],
        "alpha": 1.0,
        "p": 1,
        "q": 4,
    }
    lattice = compute_lattice(parameters)
    sites = lattice["sites"].reshape(-1, 2)
    links = lattice["links"].reshape(-1, 6)
    origin_index = int(np.argmin(np.linalg.norm(sites, axis=1)))
    origin = sites[origin_index]
    neighbors = []
    for link in links:
        if np.allclose(link[:2], origin, rtol=0, atol=1e-10):
            neighbors.append(link[2:4])
        elif np.allclose(link[2:4], origin, rtol=0, atol=1e-10):
            neighbors.append(link[:2])
    assert len(neighbors) == 3
    displacements = np.asarray(neighbors) - origin
    assert np.allclose(
        np.linalg.norm(displacements, axis=1),
        np.full(3, 1 / np.sqrt(3)),
        rtol=1e-10,
        atol=1e-10,
    )

    butterfly = compute_butterfly_batch({**parameters, "q": 47}, 1, 47)
    assert butterfly["energy"].min() < -2.9
    assert butterfly["energy"].max() > 2.9


@pytest.mark.parametrize(
    "lattice,hoppings,period,expected",
    [
        ("square", [1.0], 1, True),
        ("square", [1.0], 2, False),
        ("square", [0.0], 1, False),
        ("square", [1.0, 0.2], 1, False),
        ("triangular", [1.0], 1, False),
        ("honeycomb", [1.0], 1, False),
        ("honeycomb", [1.0, 1.0], 6, False),
        ("kagome", [1.0], 8, False),
    ],
)
def test_butterfly_reports_diophantine_topology_availability(
    lattice, hoppings, period, expected
):
    result = compute_butterfly_batch(
        {
            "lattice": lattice,
            "hoppings": hoppings,
            "period": period,
            "theta": [1, 2] if lattice == "square" else [1, 3],
            "alpha": 1.0,
            "q": 5,
        },
        1,
        5,
    )
    assert result["topology_available"] is expected


def test_custom_basis_uses_upstream_generic_hamiltonian_path():
    parameters = {
        "lattice": "custom",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 3],
        "alpha": 1.0,
        "p": 1,
        "q": 3,
        "samples": 7,
        "customBasis": [[0.0, 0.0], [0.5, 0.0], [0.0, 0.5]],
    }
    result = compute_butterfly_batch(parameters, 1, 2)
    reference = Hofstadter(
        1,
        3,
        t=[1.0],
        lat="custom",
        alpha=1.0,
        theta=(1, 3),
        period=1,
    )
    reference_energy = np.sort(
        np.linalg.eigvalsh(reference.hamiltonian(np.array([0.0, 0.0])))
    )
    assert np.allclose(
        result["energy"],
        reference_energy,
        rtol=1e-9,
        atol=1e-11,
    )
    assert result["topology_available"] is False

    two_site = {
        **parameters,
        "customBasis": [[0.0, 0.0], [0.5, 0.25]],
    }
    lattice = compute_lattice(two_site)
    with np.errstate(divide="ignore", invalid="ignore"):
        bands = compute_bands(two_site)
    assert lattice["basis_count"] == 2
    assert bands["bands"] == 2 * parameters["q"]
    assert np.isfinite(bands["energy"]).all()


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


@pytest.mark.parametrize("q", [4, 6])
def test_even_q_gap_labels_follow_the_diophantine_table(q):
    """Even-q gap labels must come from t_r, not a cumsum of the coloring.

    The upstream per-band coloring duplicates the central entry for even q,
    so cumulative sums double-count it and mislabel every gap above the
    central band touching.  The ambiguous central r = q/2 gap carries no
    label and is omitted entirely.
    """

    result = compute_butterfly_batch(
        {
            "lattice": "square",
            "hoppings": [1.0],
            "period": 1,
            "theta": [1, 2],
            "alpha": 1.0,
            "q": q,
        },
        1,
        2,
    )
    _, trs = chern(1, q)
    expected_rs = [r for r in range(1, q) if r != q // 2]
    expected_labels = [
        trs[r if r < q // 2 else r - 1] for r in expected_rs
    ]
    assert result["topology_available"] is True
    assert list(result["gap_chern"]) == expected_labels
    assert np.allclose(
        result["dos"], np.asarray(expected_rs, dtype=np.float64) / q
    )
    assert result["gap"].shape == (len(expected_rs),)
    assert result["gap_energy"].shape == (len(expected_rs),)
    assert result["gap_flux"].shape == (len(expected_rs),)


def test_odd_q_gap_labels_match_the_interior_tr_list():
    result = compute_butterfly_batch(
        {
            "lattice": "square",
            "hoppings": [1.0],
            "period": 1,
            "theta": [1, 2],
            "alpha": 1.0,
            "q": 5,
        },
        1,
        2,
    )
    _, trs = chern(1, 5)
    assert list(result["gap_chern"]) == list(trs[1:-1])
    assert np.allclose(result["dos"], np.arange(1, 5) / 5)


def test_non_coprime_flux_is_rejected():
    with pytest.raises(ValueError, match="coprime"):
        compute_bands(
            {
                "lattice": "square",
                "hoppings": [1.0],
                "period": 1,
                "theta": [1, 2],
                "alpha": 1.0,
                "p": 2,
                "q": 4,
                "samples": 7,
            }
        )


@pytest.mark.parametrize(
    "parameters",
    [
        {
            "lattice": "bravais",
            "hoppings": [0.0],
            "theta": [67, 180],
        },
        {
            "lattice": "custom",
            "hoppings": [0.0],
            "theta": [1, 3],
        },
        {
            "lattice": "square",
            "hoppings": [0.0, 0.0],
            "theta": [1, 2],
        },
    ],
)
def test_all_zero_generic_hoppings_are_rejected_cleanly(parameters):
    with pytest.raises(ValueError, match="at least one non-zero"):
        compute_butterfly_batch(
            {
                **parameters,
                "period": 1,
                "alpha": 1.0,
                "p": 1,
                "q": 3,
            },
            1,
            2,
        )


def test_extreme_hopping_is_rejected_before_linalg():
    with pytest.raises(ValueError, match="magnitude at most"):
        compute_bands(
            {
                "lattice": "square",
                "hoppings": [1e308],
                "period": 1,
                "theta": [1, 2],
                "alpha": 1.0,
                "p": 1,
                "q": 3,
                "samples": 7,
            }
        )


def test_oversized_browser_workloads_are_rejected_before_allocation():
    parameters = {
        "lattice": "custom",
        "hoppings": [1.0],
        "period": 1,
        "theta": [1, 3],
        "alpha": 1.0,
        "p": 1,
        "q": 199,
        "samples": 7,
        "customBasis": [
            [0.0, 0.0],
            [0.5, 0.0],
            [0.0, 0.5],
            [0.5, 0.5],
        ],
    }
    with pytest.raises(ValueError, match="flux sweep exceeds"):
        compute_butterfly_batch(parameters, 1, 2)
    with pytest.raises(ValueError, match="band surface.*browser budget"):
        compute_bands(parameters)
    with pytest.raises(ValueError, match="Quantum geometry.*browser budget"):
        compute_geometry(parameters)


def test_symmetry_path_reaches_the_closing_tick():
    result = compute_bands(
        {
            "lattice": "square",
            "hoppings": [1.0],
            "period": 1,
            "theta": [1, 2],
            "alpha": 1.0,
            "p": 1,
            "q": 3,
            "samples": 7,
        }
    )
    assert result["path_x"][-1] == result["path_ticks"][-1]
    path_matrix = result["path_energy"].reshape(3, -1)
    assert np.allclose(
        path_matrix[:, -1], path_matrix[:, 0], rtol=1e-12, atol=1e-12
    )
    assert result["path_k1"][-1] == result["path_k1"][0]
    assert result["path_k2"][-1] == result["path_k2"][0]
