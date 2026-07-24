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
from HT.models.hofstadter import Hofstadter


def _model(parameters: dict[str, Any], p: int | None = None) -> Hofstadter:
    theta = parameters.get("theta", [1, 3])
    return Hofstadter(
        int(parameters.get("p", 1) if p is None else p),
        int(parameters.get("q", 31)),
        a0=float(parameters.get("a", 1.0)),
        t=[float(value) for value in parameters.get("hoppings", [1.0])],
        lat=str(parameters.get("lattice", "square")),
        alpha=float(parameters.get("alpha", 1.0)),
        theta=(int(theta[0]), int(theta[1])),
        period=int(parameters.get("period", 1)),
    )


def _band_cherns(model: Hofstadter, band_count: int) -> np.ndarray:
    """Return the CLI-compatible Diophantine Chern coloring when supported."""

    base, _ = butterfly_functions.chern(model.p, model.q)
    if band_count == model.q:
        return np.asarray(base, dtype=np.int32)
    if band_count == 2 * model.q and len(model.t) == 1:
        return np.asarray(base + list(reversed(base)), dtype=np.int32)
    return np.zeros(band_count, dtype=np.int32)


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

    for p in range(max(1, int(p_start)), min(q, int(p_end))):
        if gcd(p, q) != 1:
            continue
        model = _model(parameters, p)
        eigenvalues = np.sort(
            np.linalg.eigvalsh(model.hamiltonian(np.array([0.0, 0.0])))
        ).astype(np.float64)
        band_count = eigenvalues.size
        band_cherns = _band_cherns(model, band_count)

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

    model = _model(parameters)
    samples = max(5, int(parameters.get("samples", 19)))
    band_count, _, _, reciprocal, symmetry_points = model.unit_cell()
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

    points_per_segment = max(24, samples)
    path_blocks: list[np.ndarray] = []
    path_coordinates: list[np.ndarray] = []
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

    band_gaps = (
        np.min(values[1:], axis=(1, 2))
        - np.max(values[:-1], axis=(1, 2))
        if band_count > 1
        else np.empty(0, dtype=np.float64)
    )
    if band_count > 1:
        band_gaps = np.minimum(
            band_gaps,
            np.min(path_matrix[1:] - path_matrix[:-1], axis=1),
        )
    groups: list[tuple[int, int]] = []
    group_start = 0
    for band, gap in enumerate(band_gaps):
        if gap > 0.01:
            groups.append((group_start, band + 1))
            group_start = band + 1
    groups.append((group_start, band_count))

    berry = np.zeros_like(values)
    chern_numbers = np.zeros(band_count, dtype=np.int32)
    group_starts = np.zeros(band_count, dtype=np.int32)
    group_sizes = np.ones(band_count, dtype=np.int32)
    for start, end in groups:
        size = end - start
        group_berry = np.zeros((samples, samples), dtype=np.float64)
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
        for band in range(start, end):
            berry[band] = group_berry
            chern_numbers[band] = group_chern
            group_starts[band] = start
            group_sizes[band] = size

    labels = [
        label.replace("$", "").replace("\\Gamma", "Γ")
        for label, _ in symmetry_points
    ]
    labels.append(labels[0])
    return {
        "samples": samples,
        "bands": band_count,
        "energy": np.ascontiguousarray(values).ravel(),
        "berry": np.ascontiguousarray(berry).ravel(),
        "chern": chern_numbers,
        "group_start": group_starts,
        "group_size": group_sizes,
        "path_x": np.concatenate(path_coordinates),
        "path_energy": np.ascontiguousarray(path_matrix).ravel(),
        "path_ticks": np.asarray(tick_positions, dtype=np.float64),
        "path_labels": labels,
        "reciprocal": np.ascontiguousarray(reciprocal, dtype=np.float64).ravel(),
    }


def compute_lattice(parameters: dict[str, Any]) -> dict[str, Any]:
    """Return real- and reciprocal-space geometry for declarative SVG views."""

    model = _model(parameters)
    _, lattice_vectors, basis, reciprocal, _ = model.unit_cell()
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
        "bz": bz.ravel(),
        "basis_count": len(basis),
    }
