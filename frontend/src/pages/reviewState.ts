import type { PolicyResponse, ReviewState } from "../types";

export function computeReviewState(fields: any, policy: PolicyResponse): ReviewState {
  const hasFail = policy.issues.some((i) => i.severity === "FAIL");
  if (hasFail) return "RED";

  // confidence threshold for "auto-accept"
  const CONF_T = 0.75;
  const hasLowConf = Object.values(fields).some((fv: any) => (fv?.confidence ?? 0) < CONF_T);
  const hasWarn = policy.issues.some((i) => i.severity === "WARN");

  if (hasLowConf || hasWarn) return "YELLOW";
  return "GREEN";
}
