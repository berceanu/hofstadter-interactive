"""Functions for input/output and miscellaneous use."""

# --- external imports
import csv
import json
import os
import numpy as np
import sys


_ARCHIVE_SCHEMA = "HofstadterTools.safe-npz"
_ARCHIVE_VERSION = 1
_SCHEMA_KEY = "__ht_schema__"
_METADATA_KEY = "__ht_metadata__"
_MAX_METADATA_BYTES = 16 * 1024 * 1024


def _encode_archive_value(value, arrays):
    """Encode a Python value into JSON metadata plus non-object ndarrays."""

    if isinstance(value, np.ndarray):
        if value.dtype.hasobject:
            return {
                "kind": "list",
                "items": [_encode_archive_value(item, arrays) for item in value.tolist()],
            }
        key = f"array_{len(arrays)}"
        arrays[key] = value
        return {"kind": "ndarray", "key": key}
    if isinstance(value, np.generic):
        return _encode_archive_value(value.item(), arrays)
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("Archive dictionaries must use string keys.")
        return {
            "kind": "dict",
            "items": {
                key: _encode_archive_value(item, arrays)
                for key, item in value.items()
            },
        }
    if isinstance(value, list):
        return {
            "kind": "list",
            "items": [_encode_archive_value(item, arrays) for item in value],
        }
    if isinstance(value, tuple):
        return {
            "kind": "tuple",
            "items": [_encode_archive_value(item, arrays) for item in value],
        }
    if isinstance(value, complex):
        return {"kind": "complex", "real": value.real, "imag": value.imag}
    if value is None or isinstance(value, (bool, int, float, str)):
        return {"kind": "scalar", "value": value}
    raise TypeError(f"Unsupported archive value type: {type(value).__name__}.")


def _decode_archive_value(node, arrays):
    """Decode a value produced by :func:`_encode_archive_value`."""

    if not isinstance(node, dict) or not isinstance(node.get("kind"), str):
        raise ValueError("Invalid archive metadata node.")
    kind = node["kind"]
    if kind == "ndarray":
        key = node.get("key")
        if not isinstance(key, str) or key not in arrays:
            raise ValueError("Archive metadata references a missing array.")
        value = arrays[key]
        if value.dtype.hasobject:
            raise ValueError("Object arrays are not allowed in safe archives.")
        return np.array(value, copy=True)
    if kind == "dict":
        items = node.get("items")
        if not isinstance(items, dict):
            raise ValueError("Invalid dictionary in archive metadata.")
        return {
            key: _decode_archive_value(item, arrays)
            for key, item in items.items()
            if isinstance(key, str)
        }
    if kind in {"list", "tuple"}:
        items = node.get("items")
        if not isinstance(items, list):
            raise ValueError("Invalid sequence in archive metadata.")
        decoded = [_decode_archive_value(item, arrays) for item in items]
        return tuple(decoded) if kind == "tuple" else decoded
    if kind == "complex":
        real = node.get("real")
        imag = node.get("imag")
        if not isinstance(real, (int, float)) or not isinstance(imag, (int, float)):
            raise ValueError("Invalid complex scalar in archive metadata.")
        return complex(real, imag)
    if kind == "scalar":
        value = node.get("value")
        if value is not None and not isinstance(value, (bool, int, float, str)):
            raise ValueError("Invalid scalar in archive metadata.")
        return value
    raise ValueError(f"Unknown archive metadata kind: {kind}.")


def _model_configuration(model):
    """Return the primitive parameters needed to reconstruct a model."""

    from HT.models.hofstadter import Hofstadter

    if not isinstance(model, Hofstadter):
        raise TypeError("Only Hofstadter models can be saved safely.")
    return {
        "type": "Hofstadter",
        "p": int(model.p),
        "q": int(model.q),
        "a0": float(model.a0),
        "t": [float(value) for value in model.t],
        "lat": str(model.lat),
        "alpha": float(model.alpha),
        "theta": [int(model.theta0), int(model.theta1)],
        "period": int(model.period),
    }


def _model_from_configuration(configuration):
    """Reconstruct a model from validated primitive parameters."""

    from HT.models.hofstadter import Hofstadter

    if not isinstance(configuration, dict) or configuration.get("type") != "Hofstadter":
        raise ValueError("Archive contains an unsupported model.")
    required = {"p", "q", "a0", "t", "lat", "alpha", "theta", "period"}
    if not required.issubset(configuration):
        raise ValueError("Archive model configuration is incomplete.")
    theta = configuration["theta"]
    hopping = configuration["t"]
    if (
        not isinstance(theta, list)
        or len(theta) != 2
        or not all(isinstance(value, int) for value in theta)
        or not isinstance(hopping, list)
        or not all(isinstance(value, (int, float)) for value in hopping)
    ):
        raise ValueError("Archive model configuration is invalid.")
    return Hofstadter(
        int(configuration["p"]),
        int(configuration["q"]),
        a0=float(configuration["a0"]),
        t=[float(value) for value in hopping],
        lat=str(configuration["lat"]),
        alpha=float(configuration["alpha"]),
        theta=(theta[0], theta[1]),
        period=int(configuration["period"]),
    )


def read_t_from_file():
    """Reads the hopping amplitudes from file.

    Returns
    -------
    t_list: list
        The list of hopping amplitudes in order of ascending NN.
    """

    directory = "configuration/" if os.path.isdir('configuration') else ""
    with open(directory+"hopping_input.txt", 'r') as csvfile:
        data = csv.reader(csvfile, delimiter='\t')
        NN, t = [], []
        for i, row in enumerate(data):
            NN.append(int(row[0]))
            t.append(float(row[1]))

    t_list = np.zeros(max(NN))
    for i, val in enumerate(NN):
        t_list[val-1] = t[i]

    return t_list


def create_filename(program, args, aux_text=""):
    """Create the filename string.

    Parameters
    ----------
    program: str
        The name of the program.
    args: dict
        The arguments passed to the program.
    aux_text: str
        The auxiliary text passed to the filename.

    Returns
    -------
    filename: str
        The filename string.
    """

    # read input arguments
    mod = args['model']
    a = args['a']
    t = read_t_from_file() if args['input'] else args['t']
    lat = args['lattice']
    alpha = args['alpha']
    theta = args['theta']
    save = args['save']
    log = args['log']
    period = args['periodicity']
    dpi = args['dpi']

    aux_str = aux_text if aux_text == "" else aux_text+"_"
    a_str = f"a_{a:g}_" if a != 1 else ""
    t_str = "t_" + '_'.join([f"{i:g}" for i in t]) + "_"
    brav_str = f"alpha_{alpha:g}_theta_{theta[0]:g}_{theta[1]:g}_" if lat not in ["square", "triangular"] else ""
    per_str = f"period_{period:g}_" if period != 1 else ""
    dpi_str = f"dpi_{dpi:g}_" if dpi != 300 else ""

    if program == "band_structure":
        samp = args['samp']
        wil = args['wilson']
        disp = args['display']
        nphi = args['nphi']
        bgt = args['bgt']

        disp_str = f"{disp}_"
        mod_str = f"{mod}_" if mod != "Hofstadter" else ""
        nphi_str = f"nphi_{nphi[0]}_{nphi[1]}_"
        bgt_str = f"bgt_{bgt:g}_"
        samp_str = f"samp_{samp:g}_" if samp != 101 else ""

        filename = f"band_structure_{aux_str}{disp_str}{mod_str}{lat}_{nphi_str}{a_str}{t_str}{brav_str}{per_str}{samp_str}{dpi_str}"[:-1]

    elif program == "butterfly":
        plt_lat = args["plot_lattice"]
        q = args['q']
        color = args['color']
        pal = args['palette']
        wan = args['wannier']
        art = args['art']

        q_str = f"q_{q:g}_"
        col_str = f"col_{color}_{pal}_" if color else ""
        art_str = "art_" if art else ""

        filename = f"butterfly_{aux_str}{lat}_{q_str}{a_str}{t_str}{brav_str}{col_str}{per_str}{art_str}{dpi_str}"[:-1]

    else:
        raise ValueError("program is not defined.")

    return filename


def save_data(program, model, args, data):
    """Save data to file.

    Parameters
    ----------
    program: str
        The name of the program.
    model: Hofstadter.hamiltonian
        The Hamiltonian class attribute.
    args: dict
        The arguments passed to the program.
    data: ndarray
        The data array.
    """

    directory = f"../../data/{program}/" if os.path.isdir(f"../../data/{program}/") else ""
    filename = create_filename(program, args)
    arrays = {}
    metadata = {
        "schema": _ARCHIVE_SCHEMA,
        "version": _ARCHIVE_VERSION,
        "program": program,
        "model": _model_configuration(model),
        "args": _encode_archive_value(args, arrays),
        "data": _encode_archive_value(data, arrays),
    }
    metadata_bytes = json.dumps(
        metadata,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    np.savez_compressed(
        directory + filename,
        **{
            _SCHEMA_KEY: np.frombuffer(
                f"{_ARCHIVE_SCHEMA}:{_ARCHIVE_VERSION}".encode("ascii"),
                dtype=np.uint8,
            ),
            _METADATA_KEY: np.frombuffer(metadata_bytes, dtype=np.uint8),
            **arrays,
        },
    )

    return None


def load_data(program, filename, plotting=False, trusted_legacy=False):
    """Load data from file.

    Parameters
    ----------
    program: str
        The name of the program.
    filename: str
        The name of the file to be loaded.
    plotting: bool
        The plotting script flag.
    trusted_legacy: bool
        Explicitly permit loading the pickle-based format written by
        HofstadterTools 1.0.7 and earlier. Only use for files from a trusted
        source because loading that format can execute arbitrary Python.
    """

    rel_path = "../../.." if plotting else "../.."
    directory = f"{rel_path}/data/{program}/" if os.path.isdir(f"{rel_path}/data/{program}/") else ""
    path = directory + filename
    with np.load(path, allow_pickle=False) as file_data:
        files = set(file_data.files)
        if {_SCHEMA_KEY, _METADATA_KEY}.issubset(files):
            schema_bytes = file_data[_SCHEMA_KEY]
            metadata_bytes = file_data[_METADATA_KEY]
            if (
                schema_bytes.dtype != np.uint8
                or schema_bytes.ndim != 1
                or metadata_bytes.dtype != np.uint8
                or metadata_bytes.ndim != 1
            ):
                raise ValueError("Safe archive headers must be one-dimensional uint8 arrays.")
            expected_schema = f"{_ARCHIVE_SCHEMA}:{_ARCHIVE_VERSION}"
            try:
                schema = schema_bytes.tobytes().decode("ascii")
            except UnicodeDecodeError as exc:
                raise ValueError("Safe archive schema header is not valid ASCII.") from exc
            if schema != expected_schema:
                raise ValueError(f"Unsupported archive schema: {schema!r}.")
            if metadata_bytes.nbytes > _MAX_METADATA_BYTES:
                raise ValueError("Archive metadata exceeds the 16 MB safety limit.")
            try:
                metadata = json.loads(metadata_bytes.tobytes().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("Archive metadata is not valid UTF-8 JSON.") from exc
            if (
                not isinstance(metadata, dict)
                or metadata.get("schema") != _ARCHIVE_SCHEMA
                or metadata.get("version") != _ARCHIVE_VERSION
                or metadata.get("program") != program
            ):
                raise ValueError("Archive metadata does not match the requested program.")
            array_names = files - {_SCHEMA_KEY, _METADATA_KEY}
            arrays = {name: file_data[name] for name in array_names}
            model = _model_from_configuration(metadata.get("model"))
            args = _decode_archive_value(metadata.get("args"), arrays)
            data = _decode_archive_value(metadata.get("data"), arrays)
            referenced = set()

            def collect_array_references(node):
                if isinstance(node, dict):
                    if node.get("kind") == "ndarray" and isinstance(node.get("key"), str):
                        referenced.add(node["key"])
                    for value in node.values():
                        collect_array_references(value)
                elif isinstance(node, list):
                    for value in node:
                        collect_array_references(value)

            collect_array_references(metadata.get("args"))
            collect_array_references(metadata.get("data"))
            if referenced != array_names:
                raise ValueError("Archive contains missing or unreferenced numerical arrays.")
            if not isinstance(args, dict) or not isinstance(data, dict):
                raise ValueError("Archive arguments and data must be dictionaries.")
            return model, args, data

        if not trusted_legacy:
            raise ValueError(
                "This is a legacy pickle-based HofstadterTools archive. "
                "It was not loaded because pickle files can execute arbitrary code. "
                "Only for a file you trust, opt in with --trust-legacy-pickle and "
                "save it again to convert it to the safe format."
            )

    # The unsafe loader is deliberately isolated behind the explicit opt-in.
    with np.load(path, allow_pickle=True) as file_data:
        if set(file_data.files) != {"model", "args", "data"}:
            raise ValueError("Legacy archive has an unexpected structure.")
        model = file_data["model"].item()
        args = file_data["args"].item()
        data = file_data["data"].item()
    return model, args, data


class Logger(object):
    """Stream stdout and stderr to file."""

    def __init__(self, program, args):
        self.terminal = sys.stdout or sys.stderr
        directory = f"../../logs/{program}/" if os.path.isdir(f"../../logs/{program}/") else ""
        filename = create_filename(program, args)
        self.log = open(directory+filename+".log", 'w', buffering=1)

    def write(self, message):
        self.terminal.write(message)
        self.log.write(message)

    def flush(self):
        # this flush method is needed for python 3 compatibility.
        # this handles the flush command by doing nothing.
        # you might want to specify some extra behavior here.
        pass
