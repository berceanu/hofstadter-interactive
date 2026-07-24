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
from HT.web import compute_butterfly_batch
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
console.log(`Pyodide parity passed for ${golden.length} lattice families.`);
