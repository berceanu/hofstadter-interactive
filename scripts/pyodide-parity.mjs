import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadPyodide } from "pyodide";

const root = new URL("..", import.meta.url).pathname;
const indexURL = join(root, "public", "pyodide");
const pyodide = await loadPyodide({ indexURL });
await pyodide.loadPackage("numpy");
const wheel = join(
  root,
  "public",
  "python",
  "hofstadtertools-1.0.7-py3-none-any.whl",
);
await pyodide.loadPackage(wheel);
await pyodide.runPythonAsync(`
import json
from HT.web import compute_bands, compute_butterfly_batch, compute_geometry
`);
const golden = JSON.parse(
  await readFile(join(root, "tests", "golden", "web_parity.json"), "utf8"),
);

for (const reference of golden) {
  pyodide.globals.set("_parameters", JSON.stringify(reference.parameters));
  const proxy = pyodide.runPython(
    "compute_butterfly_batch(json.loads(_parameters), 1, 5)",
  );
  const result = proxy.toJs({
    dict_converter: Object.fromEntries,
    create_pyproxies: false,
  });
  proxy.destroy();
  const energy = Array.from(result.energy);
  const chern = Array.from(result.chern);
  if (energy.length !== reference.energy.length) {
    throw new Error(`${reference.parameters.lattice}: energy shape mismatch`);
  }
  energy.forEach((value, index) => {
    const expected = reference.energy[index];
    const tolerance = 1e-11 + 1e-9 * Math.abs(expected);
    if (!Number.isFinite(value) || Math.abs(value - expected) > tolerance) {
      throw new Error(
        `${reference.parameters.lattice}: energy mismatch at ${index}`,
      );
    }
  });
  if (
    chern.length !== reference.chern.length ||
    chern.some((value, index) => value !== reference.chern[index])
  ) {
    throw new Error(`${reference.parameters.lattice}: Chern mismatch`);
  }
}

const advanced = JSON.parse(
  await readFile(
    join(root, "tests", "golden", "web_advanced_parity.json"),
    "utf8",
  ),
);
pyodide.globals.set("_parameters", JSON.stringify(advanced.parameters));

function runAdvanced(functionName) {
  const proxy = pyodide.runPython(`${functionName}(json.loads(_parameters))`);
  try {
    return proxy.toJs({
      dict_converter: Object.fromEntries,
      create_pyproxies: false,
    });
  } finally {
    proxy.destroy();
  }
}

function assertClose(actual, expected, rtol, atol, label) {
  const tolerance = atol + rtol * Math.abs(expected);
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label}: expected ${expected}, received ${actual} (tol ${tolerance})`,
    );
  }
}

const pyodideBands = runAdvanced("compute_bands");
const wilson = Array.from(pyodideBands.wilson);
if (wilson.length !== advanced.wilson.length) {
  throw new Error("Wilson-loop shape mismatch");
}
wilson.forEach((value, index) =>
  assertClose(value, advanced.wilson[index], 1e-9, 1e-10, `wilson[${index}]`),
);

const pyodideGeometry = runAdvanced("compute_geometry");
const geometryRows = Array.from(pyodideGeometry.rows);
if (geometryRows.length !== advanced.geometry_rows.length) {
  throw new Error("Geometry-row shape mismatch");
}
for (let rowIndex = 0; rowIndex < geometryRows.length; rowIndex += 1) {
  const actual = geometryRows[rowIndex];
  const expected = advanced.geometry_rows[rowIndex];
  for (const key of [
    "std_g",
    "av_gxx",
    "std_gxx",
    "av_gxy",
    "std_gxy",
    "T",
    "D",
  ]) {
    assertClose(
      Number(actual[key]),
      Number(expected[key]),
      1e-6,
      1e-9,
      `geometry row ${rowIndex} ${key}`,
    );
  }
}
const gxx = Array.from(pyodideGeometry.gxx);
const gxy = Array.from(pyodideGeometry.gxy);
advanced.probe_indices.forEach((index, probe) => {
  assertClose(gxx[index], advanced.gxx[probe], 1e-6, 1e-9, `gxx[${index}]`);
  assertClose(gxy[index], advanced.gxy[probe], 1e-6, 1e-9, `gxy[${index}]`);
});

console.log(
  `Pyodide parity passed for ${golden.length} lattice families plus Wilson and geometry.`,
);
