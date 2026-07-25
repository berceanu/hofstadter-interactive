import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const generatedPaths = new Set([
  "audit/accessibility-results.json",
  "audit/browser-playwright-results.json",
  "audit/browser-results.json",
  "audit/physics-results.json",
  "public/audit/HH_INTERACTIVE_AUDIT.html",
]);

export function auditProvenance(
  root = resolve(fileURLToPath(new URL("..", import.meta.url))),
) {
  const listed = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { cwd: root },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const files = [...new Set(listed)]
    .filter((file) => !generatedPaths.has(file))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(resolve(root, file)));
    hash.update("\0");
  }
  return {
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    source_tree_sha256: hash.digest("hex"),
    source_file_count: files.length,
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.stdout.write(`${JSON.stringify(auditProvenance())}\n`);
}
