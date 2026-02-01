# Backend/app/services/rule_summaries.py

RULE_SUMMARIES = {
    "POL-REQ-001": "A required expense field (such as merchant, date, total, currency, or category) is missing.",
    "POL-REQ-002": "A receipt image is required for this type of expense.",
    "POL-CONF-100": "The extracted value has low confidence and requires user review.",
    "POL-PARSE-101": "The amount could not be reliably parsed from the receipt text.",
    "POL-LIM-010": "Meal expenses above the standard limit require justification or attendees.",
    "POL-LIM-020": "The total expense exceeds the allowed daily limit.",
    "POL-DATE-030": "The expense date falls outside the allowed submission period.",
    "POL-JUST-040": "A business purpose is required for reimbursement.",
    "POL-CAT-050": "The selected category may not match the detected merchant type.",
    "POL-DUP-060": "This expense may be a duplicate of a previously submitted expense."
}
