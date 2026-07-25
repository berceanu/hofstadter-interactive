import { describe, expect, it } from "vitest";
import { auditStatusPasses } from "../../../scripts/audit-verdict.mjs";

describe("audit verdict statuses", () => {
  it("accepts documented passing variants without accepting failures", () => {
    expect(auditStatusPasses("pass")).toBe(true);
    expect(auditStatusPasses("pass-after-remediation")).toBe(true);
    expect(auditStatusPasses("pass-with-upstream-note")).toBe(true);
    expect(auditStatusPasses("fail")).toBe(false);
  });
});
