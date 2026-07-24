"""Pure, browser-safe computation adapters for the interactive application.

This module intentionally imports only NumPy and HofstadterTools computation
paths.  It has no command-line, plotting, file-system, logging, or progress-bar
side effects, which keeps it suitable for both native Python and Pyodide.
"""

from __future__ import annotations

from math import gcd
from typing import Any

import numpy as np

from HT.functions import band_structure as band_functions
from HT.functions import butterfly as butterfly_functions
from HT.functions import models as model_functions
from HT.models.hofstadter import Hofstadter


_geometry_base_cache: dict[str, Any] | None = None
_GEOMETRY_CACHE_LIMIT_BYTES = 64 * 1024 * 1024
_WILSON_PHASE_STEP_LIMIT = 0.95 * np.pi


def _normalized_custom_basis(parameters: dict[str, Any]) -> np.ndarray:
    """Return a small, unique fractional basis for the custom-lattice path."""

    raw_basis = parameters.get(
        "customBasis",
        parameters.get("custom_basis", [[0.0, 0.0], [0.5, 0.0], [0.0, 0.5]]),
    )
    basis: list[tuple[float, float]] = []
    for raw_point in list(raw_basis)[:4]:
        if not isinstance(raw_point, (list, tuple)) or len(raw_point) != 2:
            continue
        x, y = float(raw_point[0]), float(raw_point[1])
        if not np.isfinite(x) or not np.isfinite(y):
            continue
        point = (
            float(np.clip(x, 0.0, 0.999999)),
            float(np.clip(y, 0.0, 0.999999)),
        )
        if not any(
            abs(point[0] - existing[0]) < 1e-8
            and abs(point[1] - existing[1]) < 1e-8
            for existing in basis
        ):
            basis.append(point)
    if not basis:
        basis = [(0.0, 0.0), (0.5, 0.0), (0.0, 0.5)]
    return np.asarray(basis, dtype=np.float64)


class _CustomHofstadter(Hofstadter):
    """Adapter-only custom unit cell using the upstream generic Hamiltonian."""

    def __init__(self, *args: Any, custom_basis: np.ndarray, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.custom_basis = np.asarray(custom_basis, dtype=np.float64)

    def unit_cell(self):
        a1 = self.a0 * np.array([1.0, 0.0])
        a2 = self.a0 * self.alpha * np.array(
            [np.cos(self.theta), np.sin(self.theta)]
        )
        lattice_vectors = np.vstack((a1, a2))
        basis = np.asarray(
            [
                point[0] * a1 + point[1] * a2
                for point in self.custom_basis
            ],
            dtype=np.float64,
        )
        magnetic_vectors = np.vstack((a1, self.q * a2))
        reciprocal = model_functions.reciprocal_vectors(magnetic_vectors)
        gamma = np.array([0.0, 0.0])
        middle = np.array([0.5, 0.5])
        theta_gcd = gcd(self.theta0, self.theta1)
        reduced_denominator = self.theta1 // theta_gcd
        if reduced_denominator == 3:
            symmetry_points = [
                ("$\\Gamma$", gamma),
                ("$K$", np.array([2 / 3, 1 / 3])),
                ("$M$", middle),
                ("$K'$", np.array([1 / 3, 2 / 3])),
            ]
        else:
            symmetry_points = [
                ("$\\Gamma$", gamma),
                ("$X$", np.array([0.5, 0.0])),
                ("$M$", middle),
                ("$Y$", np.array([0.0, 0.5])),
            ]
        return (
            len(basis) * self.q,
            lattice_vectors,
            basis,
            reciprocal,
            symmetry_points,
        )


def _band_grid_key(parameters: dict[str, Any], samples: int) -> tuple[Any, ...]:
    theta = parameters.get("theta", [1, 3])
    return (
        str(parameters.get("lattice", "square")),
        int(parameters.get("p", 1)),
        int(parameters.get("q", 31)),
        float(parameters.get("a", 1.0)),
        tuple(float(value) for value in parameters.get("hoppings", [1.0])),
        float(parameters.get("alpha", 1.0)),
        (int(theta[0]), int(theta[1])),
        int(parameters.get("period", 1)),
        tuple(_normalized_custom_basis(parameters).ravel())
        if str(parameters.get("lattice", "square")) == "custom"
        else (),
        int(samples),
    )


def _model(parameters: dict[str, Any], p: int | None = None) -> Hofstadter:
    theta = parameters.get("theta", [1, 3])
    lattice = str(parameters.get("lattice", "square"))
    model_type = _CustomHofstadter if lattice == "custom" else Hofstadter
    custom_arguments = (
        {"custom_basis": _normalized_custom_basis(parameters)}
        if lattice == "custom"
        else {}
    )
    return model_type(
        int(parameters.get("p", 1) if p is None else p),
        int(parameters.get("q", 31)),
        a0=float(parameters.get("a", 1.0)),
        t=[float(value) for value in parameters.get("hoppings", [1.0])],
        lat=lattice,
        alpha=float(parameters.get("alpha", 1.0)),
        theta=(int(theta[0]), int(theta[1])),
        period=int(parameters.get("period", 1)),
        **custom_arguments,
    )


def _band_cherns(model: Hofstadter, band_count: int) -> tuple[np.ndarray, bool]:
    """Return the CLI-compatible Diophantine Chern coloring when supported."""

    base, _ = butterfly_functions.chern(model.p, model.q)
    if band_count == model.q:
        return np.asarray(base, dtype=np.int32), True
    if (
        band_count == 2 * model.q
        and len(model.t) == 1
        and model.lat == "honeycomb"
    ):
        return np.asarray(base + list(reversed(base)), dtype=np.int32), True
    return np.zeros(band_count, dtype=np.int32), False


def _topology_diagnostics(
    wilson: np.ndarray,
    chern_numbers: np.ndarray,
    groups: list[tuple[int, int]],
    *,
    grouping_consistent: bool = True,
) -> dict[str, Any]:
    """Cross-check Berry and Wilson invariants without hiding aliasing.

    Wilson phases are sampled on a principal branch.  A winding is trustworthy
    only when it agrees with the independently integrated Berry flux and no
    adjacent principal phase step approaches the Nyquist ambiguity at ``pi``.
    The complete set of group invariants must also sum to zero.
    """

    band_count = int(chern_numbers.size)
    winding = np.zeros(band_count, dtype=np.int32)
    maximum_step = np.full(band_count, np.inf, dtype=np.float64)
    group_resolved = np.zeros(band_count, dtype=np.uint8)
    total_chern = 0
    total_winding = 0

    for start, end in groups:
        phases = np.asarray(wilson[start], dtype=np.float64)
        unwrapped = np.unwrap(phases)
        group_winding = int(
            np.rint((unwrapped[0] - unwrapped[-1]) / (2 * np.pi))
        )
        phase_steps = np.abs(
            np.angle(np.exp(1j * np.diff(phases)))
        )
        group_maximum_step = (
            float(np.max(phase_steps)) if phase_steps.size else np.inf
        )
        group_chern = int(chern_numbers[start])
        resolved = (
            grouping_consistent
            and group_winding == group_chern
            and group_maximum_step < _WILSON_PHASE_STEP_LIMIT
        )
        winding[start:end] = group_winding
        maximum_step[start:end] = group_maximum_step
        group_resolved[start:end] = int(resolved)
        total_chern += group_chern
        total_winding += group_winding

    topology_resolved = bool(
        grouping_consistent
        and np.all(group_resolved)
        and total_chern == 0
        and total_winding == 0
    )
    return {
        "topology_resolved": topology_resolved,
        "topology_group_resolved": group_resolved,
        "wilson_winding": winding,
        "wilson_max_step": maximum_step,
        "topology_total_chern": int(total_chern),
        "topology_total_winding": int(total_winding),
        "topology_grouping_consistent": bool(grouping_consistent),
        "wilson_phase_step_limit": float(_WILSON_PHASE_STEP_LIMIT),
    }


def _topology_groups(
    parameters: dict[str, Any], band_count: int
) -> list[tuple[int, int]]:
    """Return validated ``(start, end)`` groups for a refinement request."""

    raw_groups = parameters.get("topology_groups")
    if raw_groups is None:
        base = compute_bands(parameters)
        starts = np.asarray(base["group_start"], dtype=np.int32)
        sizes = np.asarray(base["group_size"], dtype=np.int32)
        raw_groups = [
            [int(index), int(sizes[index])]
            for index in range(band_count)
            if int(starts[index]) == index
        ]

    groups: list[tuple[int, int]] = []
    cursor = 0
    for raw_group in raw_groups:
        if not isinstance(raw_group, (list, tuple)) or len(raw_group) != 2:
            raise ValueError("Invalid topology band-group request.")
        start = int(raw_group[0])
        size = int(raw_group[1])
        end = start + size
        if start != cursor or size < 1 or end > band_count:
            raise ValueError("Topology band groups must cover every band once.")
        groups.append((start, end))
        cursor = end
    if cursor != band_count:
        raise ValueError("Topology band groups do not cover the full spectrum.")
    return groups


def _odd_sample_count(value: Any, fallback: int, maximum: int) -> int:
    samples = max(5, min(maximum, int(value if value is not None else fallback)))
    if samples % 2 == 0:
        samples = min(maximum, samples + 1)
    return samples


def _gauss_reduce_2d(vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return a short 2D lattice basis suitable for Voronoi construction."""

    first = np.asarray(vectors[0], dtype=np.float64).copy()
    second = np.asarray(vectors[1], dtype=np.float64).copy()
    for _ in range(64):
        if np.dot(second, second) < np.dot(first, first):
            first, second = second, first
        denominator = float(np.dot(first, first))
        if denominator <= 1e-18:
            raise ValueError("Degenerate reciprocal lattice basis.")
        multiple = int(np.rint(np.dot(first, second) / denominator))
        if multiple == 0:
            return first, second
        second = second - multiple * first
    raise ValueError("Unable to reduce the reciprocal lattice basis.")


def _clip_half_plane(
    polygon: list[np.ndarray],
    normal: np.ndarray,
    offset: float,
) -> list[np.ndarray]:
    """Clip a convex polygon to ``point · normal <= offset``."""

    if not polygon:
        return []
    clipped: list[np.ndarray] = []
    previous = polygon[-1]
    previous_value = float(np.dot(previous, normal) - offset)
    for current in polygon:
        current_value = float(np.dot(current, normal) - offset)
        previous_inside = previous_value <= 1e-10
        current_inside = current_value <= 1e-10
        if previous_inside != current_inside:
            direction = current - previous
            denominator = float(np.dot(direction, normal))
            if abs(denominator) > 1e-15:
                fraction = (offset - float(np.dot(previous, normal))) / denominator
                clipped.append(previous + fraction * direction)
        if current_inside:
            clipped.append(current)
        previous = current
        previous_value = current_value
    return clipped


def _wigner_seitz_cell(reciprocal: np.ndarray) -> np.ndarray:
    """Construct the first Brillouin zone as a reciprocal Voronoi cell."""

    first, second = _gauss_reduce_2d(reciprocal)
    radius = 2.5 * (np.linalg.norm(first) + np.linalg.norm(second))
    polygon = [
        np.array([-radius, -radius], dtype=np.float64),
        np.array([radius, -radius], dtype=np.float64),
        np.array([radius, radius], dtype=np.float64),
        np.array([-radius, radius], dtype=np.float64),
    ]
    neighbors = []
    for first_index in range(-3, 4):
        for second_index in range(-3, 4):
            if first_index == 0 and second_index == 0:
                continue
            vector = first_index * first + second_index * second
            neighbors.append(vector)
    neighbors.sort(key=lambda vector: float(np.dot(vector, vector)))
    for neighbor in neighbors:
        polygon = _clip_half_plane(
            polygon,
            neighbor,
            float(np.dot(neighbor, neighbor)) / 2,
        )
        if not polygon:
            raise ValueError("Unable to construct the Brillouin zone.")

    vertices: list[np.ndarray] = []
    for vertex in polygon:
        if not vertices or np.linalg.norm(vertex - vertices[-1]) > 1e-9:
            vertices.append(vertex)
    if len(vertices) > 1 and np.linalg.norm(vertices[0] - vertices[-1]) < 1e-9:
        vertices.pop()
    vertices.append(vertices[0].copy())
    return np.asarray(vertices, dtype=np.float64)


def compute_butterfly_batch(
    parameters: dict[str, Any], p_start: int, p_end: int
) -> dict[str, np.ndarray]:
    """Compute a half-open batch of butterfly flux numerators.

    Arrays are flat and contiguous so Pyodide can turn them into JavaScript
    typed arrays without retaining live Python proxies.
    """

    q = int(parameters.get("q", 31))
    fluxes: list[np.ndarray] = []
    energies: list[np.ndarray] = []
    bands: list[np.ndarray] = []
    cherns: list[np.ndarray] = []
    dos: list[np.ndarray] = []
    gaps: list[np.ndarray] = []
    gap_cherns: list[np.ndarray] = []
    gap_fluxes: list[np.ndarray] = []
    gap_energies: list[np.ndarray] = []
    topology_available = True

    for p in range(max(1, int(p_start)), min(q, int(p_end))):
        if gcd(p, q) != 1:
            continue
        model = _model(parameters, p)
        eigenvalues = np.sort(
            np.linalg.eigvalsh(model.hamiltonian(np.array([0.0, 0.0])))
        ).astype(np.float64)
        band_count = eigenvalues.size
        band_cherns, model_topology_available = _band_cherns(model, band_count)
        topology_available = topology_available and model_topology_available

        fluxes.append(np.full(band_count, p / q, dtype=np.float64))
        energies.append(eigenvalues)
        bands.append(np.arange(band_count, dtype=np.int32))
        cherns.append(band_cherns)

        if band_count > 1:
            dos.append(
                np.arange(1, band_count, dtype=np.float64) / float(band_count)
            )
            gaps.append(np.diff(eigenvalues))
            gap_cherns.append(np.cumsum(band_cherns, dtype=np.int32)[:-1])
            gap_fluxes.append(np.full(band_count - 1, p / q, dtype=np.float64))
            gap_energies.append((eigenvalues[:-1] + eigenvalues[1:]) / 2)

    empty_float = np.empty(0, dtype=np.float64)
    empty_int = np.empty(0, dtype=np.int32)
    return {
        "topology_available": topology_available,
        "flux": np.concatenate(fluxes) if fluxes else empty_float,
        "energy": np.concatenate(energies) if energies else empty_float,
        "band": np.concatenate(bands) if bands else empty_int,
        "chern": np.concatenate(cherns) if cherns else empty_int,
        "dos": np.concatenate(dos) if dos else empty_float,
        "gap": np.concatenate(gaps) if gaps else empty_float,
        "gap_chern": np.concatenate(gap_cherns) if gap_cherns else empty_int,
        "gap_flux": np.concatenate(gap_fluxes) if gap_fluxes else empty_float,
        "gap_energy": np.concatenate(gap_energies)
        if gap_energies
        else empty_float,
    }


def compute_bands(parameters: dict[str, Any]) -> dict[str, Any]:
    """Compute a momentum-grid surface, Berry flux, and a symmetry-line cut."""

    global _geometry_base_cache
    model = _model(parameters)
    samples = max(5, int(parameters.get("samples", 19)))
    band_gap_threshold = float(parameters.get("bgt", 0.01))
    if not np.isfinite(band_gap_threshold) or band_gap_threshold < 0:
        band_gap_threshold = 0.01
    (
        band_count,
        lattice_vectors,
        _,
        reciprocal,
        symmetry_points,
    ) = model.unit_cell()
    values = np.empty((band_count, samples, samples), dtype=np.float64)
    vectors = np.empty(
        (band_count, band_count, samples, samples), dtype=np.complex128
    )

    for ix, frac_x in enumerate(np.linspace(0.0, 1.0, samples)):
        for iy, frac_y in enumerate(np.linspace(0.0, 1.0, samples)):
            momentum = np.matmul(np.array([frac_x, frac_y]), reciprocal)
            eigvals, eigvecs = np.linalg.eigh(model.hamiltonian(momentum))
            order = np.argsort(eigvals)
            values[:, ix, iy] = np.real(eigvals[order])
            vectors[:, :, ix, iy] = eigvecs[:, order]

    if values.nbytes + vectors.nbytes <= _GEOMETRY_CACHE_LIMIT_BYTES:
        _geometry_base_cache = {
            "key": _band_grid_key(parameters, samples),
            "values": values,
            "vectors": vectors,
        }
    else:
        _geometry_base_cache = None

    points_per_segment = max(24, samples)
    path_blocks: list[np.ndarray] = []
    path_coordinates: list[np.ndarray] = []
    path_momenta: list[np.ndarray] = []
    tick_positions: list[float] = []
    cursor = 0
    for index, (_, start) in enumerate(symmetry_points):
        end = symmetry_points[(index + 1) % len(symmetry_points)][1]
        fractions = np.linspace(0.0, 1.0, points_per_segment, endpoint=False)
        block = np.empty((band_count, points_per_segment), dtype=np.float64)
        for point_index, fraction in enumerate(fractions):
            fractional_k = start + (end - start) * fraction
            momentum = np.matmul(fractional_k, reciprocal)
            block[:, point_index] = np.sort(
                np.linalg.eigvalsh(model.hamiltonian(momentum))
            )
        path_blocks.append(block)
        path_momenta.append(
            start[None, :] + (end - start)[None, :] * fractions[:, None]
        )
        path_coordinates.append(
            np.linspace(
                float(cursor),
                float(cursor + points_per_segment),
                points_per_segment,
                endpoint=False,
            )
        )
        tick_positions.append(float(cursor))
        cursor += points_per_segment
    tick_positions.append(float(cursor))
    path_matrix = np.hstack(path_blocks)
    path_momentum_matrix = np.vstack(path_momenta)

    cli_adjacent_gaps = (
        np.min(values[1:], axis=(1, 2))
        - np.max(values[:-1], axis=(1, 2))
        if band_count > 1
        else np.empty(0, dtype=np.float64)
    )
    grouping_gaps = cli_adjacent_gaps.copy()
    if band_count > 1:
        grouping_gaps = np.minimum(
            grouping_gaps,
            np.min(path_matrix[1:] - path_matrix[:-1], axis=1),
        )
    band_gaps = np.full(band_count, np.nan, dtype=np.float64)
    band_gaps[:-1] = cli_adjacent_gaps
    isolated = np.ones(band_count, dtype=bool)
    for band, gap in enumerate(cli_adjacent_gaps):
        if gap < band_gap_threshold:
            isolated[band] = False
            isolated[band + 1] = False

    groups: list[tuple[int, int]] = []
    group_start = 0
    for band, gap in enumerate(grouping_gaps):
        if gap > band_gap_threshold:
            groups.append((group_start, band + 1))
            group_start = band + 1
    groups.append((group_start, band_count))

    berry = np.zeros_like(values)
    wilson = np.zeros((band_count, samples), dtype=np.float64)
    chern_numbers = np.zeros(band_count, dtype=np.int32)
    std_b_norm = np.zeros(band_count, dtype=np.float64)
    group_starts = np.zeros(band_count, dtype=np.int32)
    group_sizes = np.ones(band_count, dtype=np.int32)
    group_indices = np.zeros(band_count, dtype=np.int32)
    for group_index, (start, end) in enumerate(groups):
        size = end - start
        group_berry = np.zeros((samples, samples), dtype=np.float64)
        group_wilson = np.asarray(
            [
                band_functions.wilson_loop(vectors, start, iy, size)
                for iy in range(samples)
            ],
            dtype=np.float64,
        )
        for ix in range(samples - 1):
            for iy in range(samples - 1):
                group_berry[ix, iy] = band_functions.berry_curv(
                    vectors, start, ix, iy, size
                )
        group_berry[-1, :-1] = group_berry[0, :-1]
        group_berry[:-1, -1] = group_berry[:-1, 0]
        group_berry[-1, -1] = group_berry[0, 0]
        group_chern = int(
            np.rint(np.sum(group_berry[:-1, :-1]) / (2 * np.pi))
        )
        interior_berry = group_berry[:-1, :-1]
        with np.errstate(divide="ignore", invalid="ignore"):
            group_std_b = float(
                np.std(interior_berry) / np.abs(np.average(interior_berry))
            )
        for band in range(start, end):
            berry[band] = group_berry
            wilson[band] = group_wilson
            chern_numbers[band] = group_chern
            std_b_norm[band] = group_std_b
            group_starts[band] = start
            group_sizes[band] = size
            group_indices[band] = group_index

    topology_diagnostics = _topology_diagnostics(
        wilson,
        chern_numbers,
        groups,
    )
    band_widths = np.max(values, axis=(1, 2)) - np.min(values, axis=(1, 2))

    def gap_width_ratio(gap: float, width: float) -> float | None:
        if not np.isfinite(gap):
            return None
        with np.errstate(divide="ignore", invalid="ignore"):
            return float(np.divide(gap, width))

    property_rows = [
        {
            "band": int(band),
            "group": int(group_indices[band]),
            "isolated": bool(isolated[band]),
            "width": float(band_widths[band]),
            "gap": float(band_gaps[band])
            if np.isfinite(band_gaps[band])
            else None,
            "gap_width": gap_width_ratio(
                float(band_gaps[band]), float(band_widths[band])
            ),
            "std_B": float(std_b_norm[band]),
            "C": int(chern_numbers[band]),
        }
        for band in range(band_count - 1, -1, -1)
    ]
    group_rows = []
    for group_index, (start, end) in enumerate(groups):
        group_width = float(
            np.max(values[start:end]) - np.min(values[start:end])
        )
        group_gap = float(band_gaps[end - 1])
        group_rows.append(
            {
                "band": int(start),
                "band_end": int(end - 1),
                "group": int(group_index),
                "isolated": bool(end - start == 1 and isolated[start]),
                "width": group_width,
                "gap": group_gap if np.isfinite(group_gap) else None,
                "gap_width": gap_width_ratio(group_gap, group_width),
                "std_B": float(std_b_norm[start]),
                "C": int(chern_numbers[start]),
            }
        )

    labels = [
        label.replace("$", "").replace("\\Gamma", "Γ")
        for label, _ in symmetry_points
    ]
    sym_points = [
        {
            "label": label,
            "k1": float(point[0]),
            "k2": float(point[1]),
        }
        for label, (_, point) in zip(labels, symmetry_points)
    ]
    magnetic_bz = _wigner_seitz_cell(reciprocal)
    ordinary_reciprocal = model_functions.reciprocal_vectors(lattice_vectors)
    ordinary_bz = _wigner_seitz_cell(ordinary_reciprocal)
    labels.append(labels[0])
    return {
        "samples": samples,
        "bands": band_count,
        "energy": np.ascontiguousarray(values).ravel(),
        "berry": np.ascontiguousarray(berry).ravel(),
        "wilson": np.ascontiguousarray(wilson).ravel(),
        "chern": chern_numbers,
        **topology_diagnostics,
        "group_start": group_starts,
        "group_size": group_sizes,
        "property_rows": property_rows,
        "group_rows": group_rows,
        "bgt": band_gap_threshold,
        "path_x": np.concatenate(path_coordinates),
        "path_k1": np.ascontiguousarray(path_momentum_matrix[:, 0]),
        "path_k2": np.ascontiguousarray(path_momentum_matrix[:, 1]),
        "path_energy": np.ascontiguousarray(path_matrix).ravel(),
        "path_ticks": np.asarray(tick_positions, dtype=np.float64),
        "path_labels": labels,
        "reciprocal": np.ascontiguousarray(reciprocal, dtype=np.float64).ravel(),
        "sym_points": sym_points,
        "bz": np.ascontiguousarray(magnetic_bz).ravel(),
        "ordinary_bz": np.ascontiguousarray(ordinary_bz).ravel(),
    }


def compute_topology(parameters: dict[str, Any]) -> dict[str, Any]:
    """Refine Berry/Wilson invariants on a memory-bounded rectangular grid.

    The ordinary band request keeps a square grid suitable for rendering.
    Topology refinement instead streams one transverse momentum row at a time:
    the loop direction can be refined independently from the more demanding
    transverse Wilson-phase sampling, and only two eigenvector rows are ever
    resident.  All links still use the unchanged upstream Berry/Wilson
    functions.
    """

    model = _model(parameters)
    band_count, _, _, reciprocal, _ = model.unit_cell()
    base_samples = max(5, int(parameters.get("samples", 19)))
    samples_x = _odd_sample_count(
        parameters.get("topology_samples_x"),
        max(
            2 * base_samples - 1,
            2 * model.q - 1,
            min(81, 4 * model.q - 3),
        ),
        161,
    )
    samples_y = _odd_sample_count(
        parameters.get("topology_samples_y"),
        max(samples_x, 4 * model.q - 3),
        241,
    )
    groups = _topology_groups(parameters, band_count)
    band_gap_threshold = float(parameters.get("bgt", 0.01))
    if not np.isfinite(band_gap_threshold) or band_gap_threshold < 0:
        band_gap_threshold = 0.01

    fractions_x = np.linspace(0.0, 1.0, samples_x)
    fractions_y = np.linspace(0.0, 1.0, samples_y)
    group_wilson = np.zeros((len(groups), samples_y), dtype=np.float64)
    group_berry_sum = np.zeros(len(groups), dtype=np.float64)
    energy_minimum = np.full(band_count, np.inf, dtype=np.float64)
    energy_maximum = np.full(band_count, -np.inf, dtype=np.float64)
    previous_vectors: np.ndarray | None = None

    for iy, frac_y in enumerate(fractions_y):
        row_vectors = np.empty(
            (band_count, band_count, samples_x),
            dtype=np.complex128,
        )
        for ix, frac_x in enumerate(fractions_x):
            momentum = np.matmul(
                np.array([frac_x, frac_y], dtype=np.float64),
                reciprocal,
            )
            eigenvalues, eigenvectors = np.linalg.eigh(
                model.hamiltonian(momentum)
            )
            order = np.argsort(eigenvalues)
            ordered_values = np.real(eigenvalues[order])
            energy_minimum = np.minimum(energy_minimum, ordered_values)
            energy_maximum = np.maximum(energy_maximum, ordered_values)
            row_vectors[:, :, ix] = eigenvectors[:, order]

        wilson_vectors = row_vectors[:, :, :, None]
        for group_index, (start, end) in enumerate(groups):
            group_wilson[group_index, iy] = band_functions.wilson_loop(
                wilson_vectors,
                start,
                0,
                end - start,
            )

        if previous_vectors is not None:
            pair_vectors = np.stack(
                (previous_vectors, row_vectors),
                axis=3,
            )
            for group_index, (start, end) in enumerate(groups):
                for ix in range(samples_x - 1):
                    group_berry_sum[group_index] += (
                        band_functions.berry_curv(
                            pair_vectors,
                            start,
                            ix,
                            0,
                            end - start,
                        )
                    )
        previous_vectors = row_vectors

    chern_numbers = np.zeros(band_count, dtype=np.int32)
    wilson = np.zeros((band_count, samples_y), dtype=np.float64)
    group_starts = np.zeros(band_count, dtype=np.int32)
    group_sizes = np.ones(band_count, dtype=np.int32)
    for group_index, (start, end) in enumerate(groups):
        group_chern = int(
            np.rint(group_berry_sum[group_index] / (2 * np.pi))
        )
        chern_numbers[start:end] = group_chern
        wilson[start:end] = group_wilson[group_index]
        group_starts[start:end] = start
        group_sizes[start:end] = end - start

    refined_gaps = (
        energy_minimum[1:] - energy_maximum[:-1]
        if band_count > 1
        else np.empty(0, dtype=np.float64)
    )
    grouping_consistent = all(
        end == band_count
        or refined_gaps[end - 1] > band_gap_threshold
        for _, end in groups
    )
    topology_diagnostics = _topology_diagnostics(
        wilson,
        chern_numbers,
        groups,
        grouping_consistent=grouping_consistent,
    )
    return {
        "base_samples": base_samples,
        "samples_x": samples_x,
        "samples_y": samples_y,
        "bands": band_count,
        "wilson": np.ascontiguousarray(wilson).ravel(),
        "chern": chern_numbers,
        "group_start": group_starts,
        "group_size": group_sizes,
        **topology_diagnostics,
    }


def compute_geometry(parameters: dict[str, Any]) -> dict[str, Any]:
    """Compute the upstream quantum metric lazily for each band group.

    The finite-difference offsets and the summary statistics intentionally
    mirror ``HT.band_structure``.  Geometry is kept separate from
    :func:`compute_bands` because it requires two additional offset
    eigendiagonalization grids.
    """

    global _geometry_base_cache
    model = _model(parameters)
    samples = max(5, int(parameters.get("samples", 19)))
    band_gap_threshold = float(parameters.get("bgt", 0.01))
    if not np.isfinite(band_gap_threshold) or band_gap_threshold < 0:
        band_gap_threshold = 0.01
    band_count, _, _, reciprocal, symmetry_points = model.unit_cell()
    cache_key = _band_grid_key(parameters, samples)
    cached_base = (
        _geometry_base_cache
        if _geometry_base_cache is not None
        and _geometry_base_cache.get("key") == cache_key
        else None
    )
    if cached_base is None:
        values = np.empty((band_count, samples, samples), dtype=np.float64)
        vectors = np.empty(
            (band_count, band_count, samples, samples), dtype=np.complex128
        )
    else:
        values = cached_base["values"]
        vectors = cached_base["vectors"]
    vectors_dkx = np.empty_like(vectors)
    vectors_dky = np.empty_like(vectors)
    offset = 1.0 / (1000.0 * (samples - 1))

    for ix, frac_x in enumerate(np.linspace(0.0, 1.0, samples)):
        frac_x_dkx = (frac_x + offset) % 1.0
        for iy, frac_y in enumerate(np.linspace(0.0, 1.0, samples)):
            frac_y_dky = (frac_y + offset) % 1.0
            momentum_dkx = np.matmul(
                np.array([frac_x_dkx, frac_y]), reciprocal
            )
            momentum_dky = np.matmul(
                np.array([frac_x, frac_y_dky]), reciprocal
            )
            eigvals_dkx, eigvecs_dkx = np.linalg.eigh(
                model.hamiltonian(momentum_dkx)
            )
            eigvals_dky, eigvecs_dky = np.linalg.eigh(
                model.hamiltonian(momentum_dky)
            )
            order_dkx = np.argsort(eigvals_dkx)
            order_dky = np.argsort(eigvals_dky)
            if cached_base is None:
                momentum = np.matmul(
                    np.array([frac_x, frac_y]), reciprocal
                )
                eigvals, eigvecs = np.linalg.eigh(
                    model.hamiltonian(momentum)
                )
                order = np.argsort(eigvals)
                values[:, ix, iy] = np.real(eigvals[order])
                vectors[:, :, ix, iy] = eigvecs[:, order]
            vectors_dkx[:, :, ix, iy] = eigvecs_dkx[:, order_dkx]
            vectors_dky[:, :, ix, iy] = eigvecs_dky[:, order_dky]

    adjacent_gaps = (
        np.min(values[1:], axis=(1, 2))
        - np.max(values[:-1], axis=(1, 2))
        if band_count > 1
        else np.empty(0, dtype=np.float64)
    )
    grouping_gaps = adjacent_gaps.copy()
    if band_count > 1:
        points_per_segment = max(24, samples)
        path_minima = np.full(band_count - 1, np.inf, dtype=np.float64)
        for index, (_, start) in enumerate(symmetry_points):
            end = symmetry_points[(index + 1) % len(symmetry_points)][1]
            for fraction in np.linspace(
                0.0, 1.0, points_per_segment, endpoint=False
            ):
                fractional_k = start + (end - start) * fraction
                path_values = np.sort(
                    np.linalg.eigvalsh(
                        model.hamiltonian(
                            np.matmul(fractional_k, reciprocal)
                        )
                    )
                )
                path_minima = np.minimum(
                    path_minima, path_values[1:] - path_values[:-1]
                )
        grouping_gaps = np.minimum(grouping_gaps, path_minima)

    groups: list[tuple[int, int]] = []
    group_start = 0
    for band, gap in enumerate(grouping_gaps):
        if gap > band_gap_threshold:
            groups.append((group_start, band + 1))
            group_start = band + 1
    groups.append((group_start, band_count))

    gxx = np.zeros((band_count, samples, samples), dtype=np.float64)
    gxy = np.zeros_like(gxx)
    group_starts = np.zeros(band_count, dtype=np.int32)
    group_sizes = np.ones(band_count, dtype=np.int32)
    delta_kx = np.dot(
        np.array([1.0 / (samples - 1), 0.0]), reciprocal[0]
    )
    delta_ky = np.dot(
        np.array([0.0, 1.0 / (samples - 1)]), reciprocal[1]
    )
    rows: list[dict[str, float | int]] = []

    for group_index, (start, end) in enumerate(groups):
        size = end - start
        metric = np.zeros(
            (samples - 1, samples - 1, 2, 2), dtype=np.float64
        )
        tism = np.zeros((samples - 1, samples - 1), dtype=np.float64)
        dism = np.zeros_like(tism)
        for ix in range(samples - 1):
            for iy in range(samples - 1):
                tensor = band_functions.geom_tensor(
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
                geometry_berry = -2 * np.imag(tensor)
                berry_xy = geometry_berry[0, 1]
                tism[ix, iy] = np.trace(metric[ix, iy]) - np.abs(berry_xy)
                dism[ix, iy] = (
                    np.linalg.det(metric[ix, iy])
                    - 0.25 * np.abs(berry_xy) ** 2
                )

        group_gxx = np.zeros((samples, samples), dtype=np.float64)
        group_gxy = np.zeros_like(group_gxx)
        group_gxx[:-1, :-1] = metric[:, :, 0, 0]
        group_gxy[:-1, :-1] = metric[:, :, 0, 1]
        group_gxx[-1, :-1] = group_gxx[0, :-1]
        group_gxx[:-1, -1] = group_gxx[:-1, 0]
        group_gxx[-1, -1] = group_gxx[0, 0]
        group_gxy[-1, :-1] = group_gxy[0, :-1]
        group_gxy[:-1, -1] = group_gxy[:-1, 0]
        group_gxy[-1, -1] = group_gxy[0, 0]
        for band in range(start, end):
            gxx[band] = group_gxx
            gxy[band] = group_gxy
            group_starts[band] = start
            group_sizes[band] = size

        # Preserve the CLI's exact std_g indexing as well as its integration
        # convention for the trace and determinant inequalities.
        g_variance_sum = np.var(metric[0, 0]) + np.var(metric[0, 1])
        rows.append(
            {
                "band": int(start),
                "band_end": int(end - 1),
                "group": int(group_index),
                "std_g": float(np.sqrt(g_variance_sum)),
                "av_gxx": float(np.mean(metric[:, :, 0, 0])),
                "std_gxx": float(np.std(metric[:, :, 0, 0])),
                "av_gxy": float(np.mean(metric[:, :, 0, 1])),
                "std_gxy": float(np.std(metric[:, :, 0, 1])),
                "T": float(
                    np.sum(tism) * delta_kx * delta_ky / (2 * np.pi)
                ),
                "D": float(
                    np.sum(dism) * delta_kx * delta_ky / (2 * np.pi)
                ),
            }
        )

    result = {
        "samples": samples,
        "bands": band_count,
        "gxx": np.ascontiguousarray(gxx).ravel(),
        "gxy": np.ascontiguousarray(gxy).ravel(),
        "group_start": group_starts,
        "group_size": group_sizes,
        "rows": rows,
        "bgt": band_gap_threshold,
    }
    if cached_base is not None:
        _geometry_base_cache = None
    return result


def compute_lattice(parameters: dict[str, Any]) -> dict[str, Any]:
    """Return real- and reciprocal-space geometry for declarative SVG views."""

    model = _model(parameters)
    _, lattice_vectors, basis, reciprocal, symmetry_points = model.unit_cell()
    sites: list[tuple[float, float, int, int, int]] = []
    for i in range(-3, 4):
        for j in range(-3, 4):
            origin = np.matmul(np.array([i, j]), lattice_vectors)
            for basis_index, offset in enumerate(basis):
                position = origin + offset
                sites.append(
                    (
                        float(position[0]),
                        float(position[1]),
                        int(basis_index),
                        i,
                        j,
                    )
                )

    positions = np.asarray([[site[0], site[1]] for site in sites], dtype=np.float64)
    pair_distances: list[float] = []
    for first in range(len(positions)):
        for second in range(first + 1, len(positions)):
            distance = float(np.linalg.norm(positions[first] - positions[second]))
            if distance > 1e-9:
                pair_distances.append(round(distance, 8))
    unique_distances = sorted(set(pair_distances))
    selected = [
        (unique_distances[index], index, float(amplitude))
        for index, amplitude in enumerate(model.t)
        if index < len(unique_distances) and abs(amplitude) > 1e-12
    ]
    selected_distances = [entry[0] for entry in selected]
    links: list[tuple[float, float, float, float, int, float]] = []
    for first in range(len(positions)):
        for second in range(first + 1, len(positions)):
            distance = round(
                float(np.linalg.norm(positions[first] - positions[second])), 8
            )
            if distance in selected_distances:
                selected_index = selected_distances.index(distance)
                _, neighbor, amplitude = selected[selected_index]
                links.append(
                    (
                        float(positions[first, 0]),
                        float(positions[first, 1]),
                        float(positions[second, 0]),
                        float(positions[second, 1]),
                        neighbor,
                        amplitude,
                    )
                )

    a1, a2 = lattice_vectors
    unit_cell = np.asarray(
        [[0.0, 0.0], a1, a1 + a2, a2, [0.0, 0.0]], dtype=np.float64
    )
    bz = _wigner_seitz_cell(reciprocal)
    ordinary_reciprocal = model_functions.reciprocal_vectors(lattice_vectors)
    ordinary_bz = _wigner_seitz_cell(ordinary_reciprocal)
    magnetic_cell = np.asarray(
        [[0.0, 0.0], a1, a1 + model.q * a2, model.q * a2, [0.0, 0.0]],
        dtype=np.float64,
    )
    return {
        "sites": np.ascontiguousarray(positions).ravel(),
        "site_basis": np.asarray([site[2] for site in sites], dtype=np.int32),
        "links": np.asarray(links, dtype=np.float64).ravel()
        if links
        else np.empty(0, dtype=np.float64),
        "unit_cell": unit_cell.ravel(),
        "magnetic_cell": magnetic_cell.ravel(),
        "lattice_vectors": np.ascontiguousarray(lattice_vectors).ravel(),
        "reciprocal_vectors": np.ascontiguousarray(reciprocal).ravel(),
        "ordinary_reciprocal_vectors": np.ascontiguousarray(
            ordinary_reciprocal
        ).ravel(),
        "bz": bz.ravel(),
        "ordinary_bz": ordinary_bz.ravel(),
        "sym_points": [
            {
                "label": label.replace("$", "").replace("\\Gamma", "Γ"),
                "k1": float(point[0]),
                "k2": float(point[1]),
            }
            for label, point in symmetry_points
        ],
        "basis_count": len(basis),
    }
