"""CLI behavior when plotting extras are intentionally unavailable."""

import builtins
import sys

import pytest

from HT import band_structure, butterfly


OPTIONAL_ROOTS = {"matplotlib", "prettytable", "tqdm"}


def _block_optional_imports(monkeypatch):
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name.split(".", 1)[0] in OPTIONAL_ROOTS:
            raise ModuleNotFoundError(
                f"blocked optional dependency {name}",
                name=name,
            )
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)


@pytest.mark.parametrize(
    ("command", "module"),
    [
        ("band_structure", band_structure),
        ("butterfly", butterfly),
    ],
)
def test_help_does_not_import_optional_cli_packages(
    command,
    module,
    monkeypatch,
):
    _block_optional_imports(monkeypatch)
    monkeypatch.setattr(sys, "argv", [command, "--help"])

    with pytest.raises(SystemExit) as exit_info:
        module.main()

    assert exit_info.value.code == 0


@pytest.mark.parametrize(
    ("command", "module"),
    [
        ("band_structure", band_structure),
        ("butterfly", butterfly),
    ],
)
def test_execution_names_the_cli_extra_when_optional_packages_are_missing(
    command,
    module,
    monkeypatch,
):
    _block_optional_imports(monkeypatch)
    monkeypatch.setattr(sys, "argv", [command])

    with pytest.raises(SystemExit, match=r"HofstadterTools\[cli\]"):
        module.main()
