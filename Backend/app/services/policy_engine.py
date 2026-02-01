from typing import Dict, Any, List

from app.services.rule_summaries import RULE_SUMMARIES

CONF_THRESHOLD = 0.75


def issue(field: str, severity: str, rule_id: str, message: str) -> Dict[str, Any]:
    return {"field": field, "severity": severity, "rule_id": rule_id, "message": message}


def attach_rule_summaries(issues: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Return unique rule summaries for triggered rule IDs (policy evidence).
    """
    out: List[Dict[str, str]] = []
    seen = set()
    for i in issues:
        rid = i.get("rule_id")
        if not rid or rid in seen:
            continue
        seen.add(rid)
        summary = RULE_SUMMARIES.get(rid)
        if summary:
            out.append({"rule_id": rid, "summary": summary})
        else:
            # Fallback summary if rule_id isn't in RULE_SUMMARIES (keeps contract stable)
            out.append({"rule_id": rid, "summary": "Policy rule triggered. See rule definition repository."})
    return out


def validate_policy(receipt_id: str, fields: Dict[str, Any], user_context: Dict[str, Any]) -> Dict[str, Any]:
    issues: List[Dict[str, Any]] = []

    # 1) Required fields
    for f in ["merchant", "date", "total", "currency", "category"]:
        if not fields.get(f, {}).get("value"):
            issues.append(issue(f, "FAIL", "POL-REQ-001", f"{f} is required."))

    # 2) Confidence-based review (seamful automation control signal)
    for f, v in fields.items():
        try:
            conf = float(v.get("confidence", 0))
        except Exception:
            conf = 0.0

        if conf < CONF_THRESHOLD:
            issues.append(issue(f, "WARN", "POL-CONF-100", f"{f} confidence below threshold ({conf:.2f})."))

    # 3) Example: meals limit (toy policy)
    # Note: keep this deterministic. LLM is NOT used here.
    if fields.get("category", {}).get("value", "").lower() in {"meals", "meal", "food"}:
        try:
            total_val = str(fields.get("total", {}).get("value", "0")).replace(",", ".")
            total = float(total_val)
            if total > 20:
                issues.append(
                    issue("total", "FAIL", "POL-LIM-010", "Meals exceed 20 EUR without justification/attendees.")
                )
        except Exception:
            # Use the rule id that exists in your RULE_SUMMARIES (we defined POL-PARSE-101 earlier)
            issues.append(issue("total", "WARN", "POL-PARSE-101", "Could not parse total amount reliably."))

    # 4) Compliance aggregation
    compliance = "PASS"
    if any(i["severity"] == "FAIL" for i in issues):
        compliance = "FAIL"
    elif any(i["severity"] == "WARN" for i in issues):
        compliance = "WARN"

    # 5) Policy evidence (rule summaries)
    rule_summaries = attach_rule_summaries(issues)

    return {
        "receipt_id": receipt_id,
        "compliance": compliance,
        "issues": issues,
        "rule_summaries": rule_summaries,
        "metadata": {
            "confidence_threshold": CONF_THRESHOLD,
            "rules_triggered": [r["rule_id"] for r in rule_summaries],
        },
    }
