import re
import uuid
from typing import List, Dict, Any, Optional, Tuple

CURRENCY_REGEX = r"(EUR|€|USD|\$|GBP|£|INR|₹)"
AMOUNT_REGEX = r"([0-9]+[.,][0-9]{2})"

DATE_REGEXES = [
    r"\b(\d{4}[./-]\d{2}[./-]\d{2})\b",          # 2013-11-03
    r"\b(\d{2}[./-]\d{2}[./-]\d{2,4})\b",        # 11/03/2013 or 11-03-13
]

NOISE_PREFIXES = [
    "duplicate", "copy", "merchant copy", "customer copy",
    "thank you", "tax invoice", "invoice", "receipt"
]


def _clean_line(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s


def _is_noise_line(line: str) -> bool:
    low = line.lower()
    if len(low) < 3:
        return True
    return any(p in low for p in NOISE_PREFIXES)


def _avg_conf(words: List[Dict[str, Any]], tokens: List[str]) -> float:
    """
    Approximate confidence for a phrase by averaging token confidences.
    """
    if not tokens:
        return 0.0
    token_set = {t.lower() for t in tokens if t}
    matched = []
    for w in words:
        t = (w.get("text") or "").lower()
        c = w.get("conf", -1.0)
        if t in token_set and isinstance(c, (int, float)) and c >= 0:
            matched.append(float(c))
    if not matched:
        return 0.5
    return sum(matched) / len(matched)


def _normalize_amount(s: str) -> str:
    if not s:
        return ""
    s = s.strip().replace(",", ".")
    # Keep only digits + dot
    s = re.sub(r"[^0-9.]", "", s)
    return s


def _find_date(text: str) -> Tuple[str, float]:
    """
    Try multiple patterns including spaced separators.
    """
    # Handles "2013 - 11 - 03" with spaces
    m = re.search(r"\b(\d{4}\s*[./-]\s*\d{2}\s*[./-]\s*\d{2})\b", text)
    if m:
        return re.sub(r"\s+", "", m.group(1)), 0.8

    for pat in DATE_REGEXES:
        m = re.search(pat, text)
        if m:
            return m.group(1), 0.75

    return "", 0.3


def _find_currency(text: str) -> Tuple[str, float]:
    m = re.search(CURRENCY_REGEX, text)
    if m:
        return m.group(1), 0.9
    # default assumption (thesis demo)
    return "EUR", 0.6


def _extract_amount_on_lines(lines: List[str], keyword: str, avoid_keyword: Optional[str] = None) -> Optional[str]:
    """
    Search from bottom (totals are usually at bottom) for a line containing `keyword`,
    optionally avoiding lines containing `avoid_keyword` (e.g., TOTAL vs SUBTOTAL).
    """
    key = keyword.lower()
    avoid = avoid_keyword.lower() if avoid_keyword else None

    for line in reversed(lines):
        low = line.lower()
        if key in low:
            if avoid and avoid in low:
                continue
            # Extract the last money-like number on that line
            matches = list(re.finditer(AMOUNT_REGEX, line.replace(",", ".")))
            if matches:
                return matches[-1].group(1)
    return None


def _extract_all_amounts(lines: List[str], last_n_lines: int = 30) -> List[float]:
    nums: List[float] = []
    for line in lines[-last_n_lines:]:
        for m in re.finditer(AMOUNT_REGEX, line.replace(",", ".")):
            try:
                nums.append(float(m.group(1)))
            except Exception:
                continue
    return nums


def _find_total(lines: List[str]) -> Tuple[str, float]:
    """
    Robust strategy:
    1) Try "Total" line (avoid "Sub Total")
    2) Try "Amount Due" / "Balance Due" fallback
    3) If subtotal+tax exist, compute and sanity-check
    4) Else fallback to max amount near bottom
    """
    # Prefer explicit TOTAL (avoid SUBTOTAL confusion)
    total = _extract_amount_on_lines(lines, "total", avoid_keyword="sub")
    # Some receipts use "amount due"
    if not total:
        total = _extract_amount_on_lines(lines, "amount due")
    if not total:
        total = _extract_amount_on_lines(lines, "balance due")

    subtotal = _extract_amount_on_lines(lines, "sub total")
    if not subtotal:
        subtotal = _extract_amount_on_lines(lines, "subtotal")

    tax = _extract_amount_on_lines(lines, "tax")

    total_n = _normalize_amount(total) if total else ""
    subtotal_n = _normalize_amount(subtotal) if subtotal else ""
    tax_n = _normalize_amount(tax) if tax else ""

    # If we have subtotal + tax, compute expected total and sanity-check OCR total
    if subtotal_n and tax_n:
        try:
            st = float(subtotal_n)
            tx = float(tax_n)
            expected = st + tx

            if total_n:
                t = float(total_n)
                # If OCR total is suspiciously far from expected, override with computed total
                # This fixes errors like 31.44 vs 191.44
                if abs(t - expected) > 1.0:
                    return f"{expected:.2f}", 0.7
                return f"{t:.2f}", 0.8

            return f"{expected:.2f}", 0.65
        except Exception:
            pass

    # If total exists but no subtotal/tax, return it
    if total_n:
        try:
            return f"{float(total_n):.2f}", 0.8
        except Exception:
            return total_n, 0.6

    # Last fallback: choose the largest amount appearing near the bottom
    amounts = _extract_all_amounts(lines, last_n_lines=30)
    if amounts:
        return f"{max(amounts):.2f}", 0.5

    return "", 0.3


def _find_merchant(lines: List[str], words: List[Dict[str, Any]]) -> Tuple[str, float]:
    """
    Merchant is typically in first ~10 lines. Skip noise and address-heavy lines.
    """
    candidates: List[str] = []
    for line in lines[:12]:
        l = _clean_line(line)
        if not l or _is_noise_line(l):
            continue

        # Skip lines that are mostly numeric / address-like
        digits = re.sub(r"\D", "", l)
        if len(digits) >= 6 and len(l) > 8:
            continue

        # Must contain letters
        if re.search(r"[A-Za-z]", l):
            candidates.append(l)

    if not candidates:
        fallback = lines[0] if lines else ""
        return fallback, 0.4

    merchant = candidates[0]
    merchant = re.sub(r"^[^A-Za-z]+", "", merchant).strip()

    conf = _avg_conf(words, merchant.split()[:4])
    conf = max(0.4, min(conf, 0.95))
    return merchant, round(conf, 2)


def parse_receipt_fields(text: str, words: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Produce structured fields for the thesis MVP.
    """
    receipt_id = "r_" + uuid.uuid4().hex[:8]

    raw_lines = [l for l in (text or "").splitlines() if l.strip()]
    lines = [_clean_line(l) for l in raw_lines]

    merchant, merchant_conf = _find_merchant(lines, words)
    date_val, date_conf = _find_date(text or "")
    total_val, total_conf = _find_total(lines)
    cur_val, cur_conf = _find_currency(text or "")

    # Category remains user-selected (low confidence by design)
    category_val = "Uncategorized"
    category_conf = 0.2

    return {
        "receipt_id": receipt_id,
        "fields": {
            "merchant": {"value": merchant, "confidence": float(merchant_conf)},
            "date": {"value": date_val, "confidence": float(round(date_conf, 2))},
            "total": {"value": total_val, "confidence": float(round(total_conf, 2))},
            "currency": {"value": cur_val, "confidence": float(round(cur_conf, 2))},
            "category": {"value": category_val, "confidence": float(category_conf)},
        }
    }
