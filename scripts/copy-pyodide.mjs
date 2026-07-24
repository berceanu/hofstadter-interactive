import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = join(root, "node_modules", "pyodide");
const target = join(root, "public", "pyodide");
await mkdir(target, { recursive: true });

const runtimeFiles = [
  "pyodide-lock.json",
  "pyodide.asm.wasm",
  "pyodide.asm.mjs",
  "pyodide.mjs",
  "python_stdlib.zip",
];
await Promise.all(
  runtimeFiles.map((file) => copyFile(join(source, file), join(target, file))),
);

const lock = JSON.parse(await readFile(join(source, "pyodide-lock.json"), "utf8"));
const version = JSON.parse(await readFile(join(source, "package.json"), "utf8")).version;
for (const packageName of ["numpy", "micropip"]) {
  const metadata = lock.packages[packageName];
  const destination = join(target, basename(metadata.file_name));
  let valid = false;
  try {
    await stat(destination);
    const digest = createHash("sha256")
      .update(await readFile(destination))
      .digest("hex");
    valid = digest === metadata.sha256;
  } catch {
    valid = false;
  }
  if (!valid) {
    const response = await fetch(
      `https://cdn.jsdelivr.net/pyodide/v${version}/full/${metadata.file_name}`,
    );
    if (!response.ok) {
      throw new Error(`Unable to download ${metadata.file_name}: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== metadata.sha256) {
      throw new Error(`Checksum mismatch for ${metadata.file_name}`);
    }
    await writeFile(destination, bytes);
  }
}
