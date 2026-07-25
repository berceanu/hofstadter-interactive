"""Security and compatibility tests for native data archives."""

import os

import numpy as np
import pytest

from HT.functions import utility
from HT.models.hofstadter import Hofstadter


def _args():
    return {
        "model": "Hofstadter",
        "a": 1.0,
        "t": [1.0],
        "input": False,
        "lattice": "square",
        "alpha": 1.0,
        "theta": [1, 2],
        "save": True,
        "log": False,
        "periodicity": 1,
        "dpi": 300,
        "samp": 5,
        "wilson": False,
        "display": "3D",
        "nphi": [1, 3],
        "bgt": 0.01,
    }


def test_safe_archive_round_trip_without_pickle(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(utility, "create_filename", lambda _program, _args: "safe")
    model = Hofstadter(1, 3, t=[1.0], lat="square", theta=(1, 2))
    args = _args()
    data = {
        "energies": np.array([-1.0, 0.0, 1.0]),
        "vectors": np.eye(2, dtype=np.complex128),
        "ragged": [np.arange(2), np.arange(3)],
        "optional": None,
        "shape": (2, 3),
    }

    utility.save_data("band_structure", model, args, data)
    with np.load("safe.npz", allow_pickle=False) as archive:
        assert not any(archive[name].dtype.hasobject for name in archive.files)

    loaded_model, loaded_args, loaded_data = utility.load_data(
        "band_structure", "safe.npz"
    )
    assert loaded_model.p == 1
    assert loaded_model.q == 3
    assert loaded_model.lat == "square"
    assert loaded_args == args
    np.testing.assert_array_equal(loaded_data["energies"], data["energies"])
    np.testing.assert_array_equal(loaded_data["vectors"], data["vectors"])
    np.testing.assert_array_equal(loaded_data["ragged"][1], data["ragged"][1])
    assert loaded_data["shape"] == (2, 3)


class _TouchOnUnpickle:
    def __init__(self, marker):
        self.marker = marker

    def __reduce__(self):
        return os.system, (f"touch {self.marker}",)


def test_legacy_archive_is_rejected_without_executing_pickle(tmp_path):
    marker = tmp_path / "executed"
    archive_path = tmp_path / "legacy.npz"
    np.savez_compressed(
        archive_path,
        model=np.array(_TouchOnUnpickle(marker), dtype=object),
        args=np.array({}, dtype=object),
        data=np.array({}, dtype=object),
    )

    with pytest.raises(ValueError, match="legacy pickle-based"):
        utility.load_data("band_structure", str(archive_path))
    assert not marker.exists()


def test_trusted_legacy_archive_remains_an_explicit_conversion_path(tmp_path):
    archive_path = tmp_path / "legacy.npz"
    model = Hofstadter(1, 3, t=[1.0], lat="square")
    args = _args()
    data = {"energies": np.arange(3)}
    np.savez_compressed(archive_path, model=model, args=args, data=data)

    loaded_model, loaded_args, loaded_data = utility.load_data(
        "band_structure",
        str(archive_path),
        trusted_legacy=True,
    )
    assert loaded_model.q == model.q
    assert loaded_args == args
    np.testing.assert_array_equal(loaded_data["energies"], data["energies"])
