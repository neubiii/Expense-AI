from typing import Dict, Any, List

def _dedupe(xs: List[str]) -> List[str]:
    out = []
    seen = set()
    for x in xs:
        if x and x not in seen:
            out.append(x)
            seen.add(x)
    return out

def mock_explain_with_policy(fields: Dict[str, Any],
                             issues: List[Dict[str, Any]],
                             rule_summaries: List[Dict[str, Any]],
                             user_question: str) -> Dict[str, Any]:
    """
    Mock explanation generator (no API).
    Uses only deterministic inputs: issues + rule_summaries + field confidences.
    Returns the same JSON shape as the real LLM endpoint.
    """

    # Map rule_id -> summary
    summary_map = {r.get("rule_id"): r.get("summary") for r in (rule_summaries or [])}

    # Build explanation
    if not issues:
        explanation = (
            "No policy issues were detected. All required fields are present and the extracted values "
            "are above the confidence threshold. You can proceed to submission."
        )
        return {"explanation": explanation, "clarification_questions": []}

    # Sort: FAIL first, then WARN
    sev_rank = {"FAIL": 0, "WARN": 1}
    issues_sorted = sorted(issues, key=lambda i: sev_rank.get(i.get("severity", "WARN"), 9))

    bullets = []
    clarifications = []

    for i in issues_sorted[:6]:  # keep it short for UI
        field = i.get("field", "unknown field")
        rid = i.get("rule_id", "UNKNOWN")
        sev = i.get("severity", "WARN")
        msg = i.get("message", "")
        summ = summary_map.get(rid)

        if summ:
            bullets.append(f"- **{sev}** `{rid}` ({field}): {summ}")
        else:
            bullets.append(f"- **{sev}** `{rid}` ({field}): {msg or 'Policy check triggered.'}")

        # Generate clarification questions based on common rules
        if rid == "POL-REQ-001":
            clarifications.append(f"Please provide the missing value for **{field}**.")
        elif rid == "POL-REQ-002":
            clarifications.append("Please attach a receipt image to proceed.")
        elif rid == "POL-CONF-100":
            clarifications.append(f"Can you confirm or correct the extracted **{field}** value?")
        elif rid == "POL-PARSE-101":
            clarifications.append("Please enter the total amount manually (could not be parsed reliably).")
        elif rid == "POL-LIM-010":
            clarifications.append("Was this a business meal? If yes, add business purpose and attendees (if applicable).")
        elif rid == "POL-LIM-020":
            clarifications.append("Can you provide justification for exceeding the daily limit, or split into multiple lines if allowed?")
        elif rid == "POL-DATE-030":
            clarifications.append("Is the receipt date correct? If yes, provide justification for late/out-of-range submission.")
        elif rid == "POL-JUST-040":
            clarifications.append("Please add a short business purpose (e.g., client meeting, travel, workshop).")
        elif rid == "POL-CAT-050":
            clarifications.append("Does the selected category match the merchant? If not, choose the correct category.")
        elif rid == "POL-DUP-060":
            clarifications.append("Have you already submitted this receipt? If not, confirm it’s a new expense.")

    clarifications = _dedupe(clarifications)

    # Compose final explanation
    explanation = (
        f"Based on the current extracted fields and deterministic policy checks, the system flagged the expense due to "
        f"the following rule(s):\n\n" + "\n".join(bullets) +
        "\n\nTo proceed, please address the requested fields or provide the required justification. "
        "After edits, re-run the policy validation to confirm compliance."
    )

    return {
        "explanation": explanation,
        "clarification_questions": clarifications[:5]  # keep concise
    }
