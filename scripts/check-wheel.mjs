// Fails the static-asset build when the wheel filename referenced by the
// runtime drifts from the version pyproject.toml actually builds, so a
// version bump cannot ship a site that fetches a nonexistent wheel.
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pyproject = await readFile(join(root, "pyproject.toml"), "utf8");
const version = pyproject.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!version) {
  throw new Error("Unable to read the project version from pyproject.toml.");
}
const wheelName = `hofstadtertools-${version}-py3-none-any.whl`;

await access(join(root, "public", "python", wheelName)).catch(() => {
  throw new Error(
    `public/python/${wheelName} is missing; run npm run python:wheel.`,
  );
});

const worker = await readFile(
  join(root, "web", "src", "compute", "compute.worker.ts"),
  "utf8",
);
if (!worker.includes(wheelName)) {
  throw new Error(
    `web/src/compute/compute.worker.ts does not reference ${wheelName}; update its wheel URL to match pyproject.toml ${version}.`,
  );
}
console.log(`Wheel reference check passed for ${wheelName}.`);
