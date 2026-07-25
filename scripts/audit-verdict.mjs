export function auditStatusPasses(status) {
  const value = String(status);
  return value === "pass" || value.startsWith("pass-");
}
