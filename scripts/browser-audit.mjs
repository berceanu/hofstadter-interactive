import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditProvenance } from "./audit-provenance.mjs";

const root = new URL("..", import.meta.url).pathname;
const auditRoot = join(root, "audit");
const rawReport = join(auditRoot, "browser-playwright-results.json");
await mkdir(auditRoot, { recursive: true });
// Never let a runner startup failure reuse the previous run's JSON.
await writeFile(rawReport, "");

const executable = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);
const reporters =
  process.env.GITHUB_ACTIONS === "true" ? "github,json" : "line,json";
const command = `playwright test --reporter=${reporters}`;
const run = spawnSync(executable, ["test", `--reporter=${reporters}`], {
  cwd: root,
  env: {
    ...process.env,
    // Audit evidence must come from a server started for this checkout.
    // Playwright disables reuseExistingServer when CI is set.
    CI: "1",
    PW_PORT: process.env.PW_PORT ?? "4273",
    PLAYWRIGHT_JSON_OUTPUT_NAME: rawReport,
  },
  stdio: "inherit",
});

let report;
let parseFailure;
try {
  report = JSON.parse(await readFile(rawReport, "utf8"));
} catch (error) {
  parseFailure = error instanceof Error ? error.message : String(error);
  report = { suites: [] };
}

const checks = [];
function collectSuites(suites = [], ancestors = []) {
  for (const suite of suites) {
    const path = [...ancestors, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      const testRuns = spec.tests ?? [];
      const results = testRuns.flatMap((test) => test.results ?? []);
      const finalResults = testRuns
        .map((test) => test.results?.at(-1))
        .filter(Boolean);
      const failing = finalResults.find((result) =>
        !["passed", "skipped"].includes(result.status)
      );
      const skipped =
        finalResults.length > 0
        && finalResults.every((result) => result.status === "skipped");
      const retried = testRuns.some((test) => {
        const attempts = test.results ?? [];
        return attempts.length > 1
          && attempts.slice(0, -1).some((result) =>
            !["passed", "skipped"].includes(result.status)
          )
          && attempts.at(-1)?.status === "passed";
      });
      const missing = testRuns.length === 0 || finalResults.length !== testRuns.length;
      checks.push({
        scenario: [...path, spec.title].join(" › "),
        status: failing || missing
          ? "fail"
          : skipped
            ? "pass-skipped"
            : retried
              ? "pass-after-retry"
              : "pass",
        detail: failing || missing
          ? failing?.error?.message
            ?? (missing
              ? "Playwright emitted no final result for one or more project runs."
              : `Playwright status: ${failing.status}`)
          : skipped
            ? "Explicitly skipped by the project matrix."
            : `${results.reduce((total, result) => total + (result.duration ?? 0), 0)} ms across ${Math.max(1, testRuns.length)} project run(s)${retried ? " including a passed retry" : ""}.`,
      });
    }
    collectSuites(suite.suites, path);
  }
}
collectSuites(report.suites);

const failedChecks = checks.filter((check) => check.status === "fail");
const passed =
  run.status === 0
  && !run.error
  && !parseFailure
  && checks.length > 0
  && failedChecks.length === 0;
const provenance = auditProvenance(root);
const result = {
  schema: "hofstadter-interactive/browser-audit/1",
  generated_at: new Date().toISOString(),
  provenance,
  status: passed ? "pass" : "fail",
  command,
  review_verdict: {
    confirmed_findings_fixed: 8,
    summary:
      "The browser matrix is generated from the current Playwright run; static screenshots are retained only as historical visual context.",
  },
  friend_claims: [],
  baseline_findings: [
    {
      severity: "high",
      finding: "Unsafe native pickle archives could execute code.",
      resolution:
        "New saves use a versioned primitive-only NPZ schema; legacy pickle loading requires an explicit trusted-file opt-in.",
    },
    {
      severity: "high",
      finding: "Large valid browser workloads could exhaust memory or remain uninterruptible.",
      resolution:
        "The adapter rejects oversized sweeps and grids before allocation, and obsolete synchronous jobs terminate and recreate the worker.",
    },
    {
      severity: "high",
      finding: "Raw energies were mislabeled as normalized E/t₁.",
      resolution:
        "All spectral and surface labels now state the upstream raw energy E.",
    },
    {
      severity: "high",
      finding: "Published audit evidence could remain stale while displaying PASS.",
      resolution:
        "Physics, browser, and accessibility evidence carries a source-tree fingerprint; report generation refuses mismatched inputs and still renders failures.",
    },
    {
      severity: "medium",
      finding: "Base Python installs broke CLI help when optional UI packages were absent.",
      resolution:
        "Argument parsing now precedes optional plotting imports, and actual CLI execution names the required cli extra.",
    },
    {
      severity: "medium",
      finding: "All-zero generic hopping and extreme amplitudes reached NumPy failures.",
      resolution:
        "Browser and Python boundaries bound amplitudes and return a clear domain error for undefined all-zero generic models.",
    },
    {
      severity: "low",
      finding: "Wilson-row selection was pointer-only.",
      resolution:
        "The Wilson plot exposes a focusable slider with arrow, page, Home, and End keyboard controls.",
    },
    {
      severity: "low",
      finding: "The Pages workflow granted broad permissions and trusted mutable action tags.",
      resolution:
        "Jobs now use least-privilege permissions, disable persisted checkout credentials, and pin every action to an exact commit.",
    },
  ],
  final_checks: checks,
  additional_checks: [
    {
      scenario: "generated-browser-matrix",
      status: passed ? "pass" : "fail",
      detail: `${checks.length} Playwright specifications recorded; ${failedChecks.length} failed.${parseFailure ? ` Reporter error: ${parseFailure}` : ""}${run.error ? ` Runner error: ${run.error.message}` : ""}`,
    },
  ],
  limitations: [
    {
      check: "Manual assistive-technology session",
      result: "not claimed",
      reason:
        "Automated semantics, keyboard interaction, contrast, reduced motion, and responsive browser behavior are covered; a separate screen-reader session was not run.",
    },
    {
      check: "Live dependency advisory services",
      result: "separate control",
      reason:
        "The source audit does not replace continuously refreshed npm and Python advisory scans.",
    },
  ],
};

await writeFile(
  join(auditRoot, "browser-results.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(
  `Browser audit ${result.status}: ${checks.length} specifications recorded.`,
);
if (!passed) process.exitCode = 1;
