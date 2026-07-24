import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const checks = [
  ["primary text", "#ecf3ee", "#07101b"],
  ["secondary labels", "#71879a", "#0c1826"],
  ["parameter help", "#71879a", "#091420"],
  ["interaction hint", "#7d91a2", "#08111d"],
  ["panel kicker", "#7d91a2", "#0b1724"],
  ["surface axes", "#6d8292", "#0b1724"],
  ["mint accent", "#5cf2ce", "#07101b"],
  ["gold data accent", "#ffd166", "#07101b"],
];

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const results = checks.map(([name, foreground, background]) => ({
  name,
  foreground,
  background,
  ratio: Number(contrast(foreground, background).toFixed(2)),
  minimum: 4.5,
  pass: contrast(foreground, background) >= 4.5,
}));
const output = {
  status: results.every((result) => result.pass) ? "pass" : "fail",
  standard: "WCAG 2.2 AA normal text contrast",
  results,
};
const auditDirectory = join(root, "audit");
await mkdir(auditDirectory, { recursive: true });
await writeFile(
  join(auditDirectory, "accessibility-results.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(`Accessibility contrast audit ${output.status}.`);
if (output.status !== "pass") process.exitCode = 1;
