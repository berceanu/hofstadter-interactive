import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const commands = [
  [join(root, ".venv", "bin", "python"), ["scripts/physics-audit.py"]],
  [process.execPath, ["scripts/accessibility-audit.mjs"]],
  [process.execPath, ["scripts/browser-audit.mjs"]],
];
let failed = false;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0 || result.error) failed = true;
}

const rendered = spawnSync(
  process.execPath,
  ["scripts/build-audit-report.mjs"],
  { cwd: root, stdio: "inherit" },
);
if (rendered.status !== 0 || rendered.error) failed = true;
if (failed) process.exitCode = 1;
