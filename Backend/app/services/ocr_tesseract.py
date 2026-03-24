import io
import re
import os
from typing import Dict, Any, List, Tuple

import numpy as np
import cv2
from PIL import Image
import pytesseract

# IMPORTANT:
# Prefer the real installed tesseract path (usually Program Files).
# If you keep a custom path, ensure tessdata exists too.
pytesseract.pytesseract.tesseract_cmd = r"E:\Thesis-SRH\tesseract.exe"

# If your tesseract.exe is not the real install, tessdata might be missing.
# In that case set TESSDATA_PREFIX to the folder that contains "tessdata".
# Example:
# os.environ["TESSDATA_PREFIX"] = r"C:\Program Files\Tesseract-OCR"


def _to_gray(pil_img: Image.Image) -> np.ndarray:
    img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return gray


def _resize_for_ocr(gray: np.ndarray) -> np.ndarray:
    # Upscale small receipts; keep it reasonable to avoid blur.
    h, w = gray.shape[:2]
    if w < 1200:
        scale = 1200 / max(1, w)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return gray


def _normalize_contrast(gray: np.ndarray) -> np.ndarray:
    # CLAHE helps a lot for warm lighting / shadows on receipts.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _denoise_and_sharpen(gray: np.ndarray) -> np.ndarray:
    # Denoise
    den = cv2.fastNlMeansDenoising(gray, None, h=18, templateWindowSize=7, searchWindowSize=21)
    # Mild sharpen (unsharp mask)
    blur = cv2.GaussianBlur(den, (0, 0), 1.2)
    sharp = cv2.addWeighted(den, 1.6, blur, -0.6, 0)
    return sharp


def _binarize_variants(gray: np.ndarray) -> List[np.ndarray]:
    # Variant A: adaptive threshold (good for uneven illumination, sometimes too aggressive)
    thr_adapt = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31, 8
    )

    # Variant B: Otsu (often great for clean, high-contrast receipts)
    _, thr_otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Small morphology to close tiny gaps (don’t overdo)
    kernel = np.ones((2, 2), np.uint8)
    thr_adapt = cv2.morphologyEx(thr_adapt, cv2.MORPH_CLOSE, kernel, iterations=1)
    thr_otsu = cv2.morphologyEx(thr_otsu, cv2.MORPH_CLOSE, kernel, iterations=1)

    return [thr_adapt, thr_otsu]


def _deskew(bin_img: np.ndarray) -> np.ndarray:
    """
    Deskew using text angle estimation.
    Works best when bin_img is black text on white background.
    """
    # Invert: text becomes white on black for angle detection
    inv = cv2.bitwise_not(bin_img)
    coords = np.column_stack(np.where(inv > 0))
    if coords.size < 1000:
        return bin_img

    rect = cv2.minAreaRect(coords)
    angle = rect[-1]
    # minAreaRect angle logic
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    if abs(angle) < 0.6:
        return bin_img

    (h, w) = bin_img.shape[:2]
    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    rotated = cv2.warpAffine(bin_img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return rotated


def _ocr_once(proc: np.ndarray, psm: int) -> Tuple[str, List[Dict[str, Any]]]:
    # Preserve spaces helps receipts (item + price columns)
    config = f"--oem 3 --psm {psm} -l eng -c preserve_interword_spaces=1"

    text = pytesseract.image_to_string(proc, config=config)

    data = pytesseract.image_to_data(
        proc,
        config=config,
        output_type=pytesseract.Output.DICT
    )

    words: List[Dict[str, Any]] = []
    n = len(data.get("text", []))
    for i in range(n):
        w = (data["text"][i] or "").strip()
        if not w:
            continue
        try:
            conf_raw = float(data["conf"][i])
        except Exception:
            conf_raw = -1.0
        conf = max(0.0, conf_raw) / 100.0
        words.append({"text": w, "conf": conf})

    return text, words


def _score_text(text: str) -> float:
    """
    Better heuristic for receipts:
    - reward money patterns
    - reward presence of 'total'/'subtotal'
    - reward digits and structured lines
    - penalize extremely low alphabet ratio
    """
    t = text or ""
    lines = [l for l in t.splitlines() if l.strip()]
    digits = sum(ch.isdigit() for ch in t)
    letters = sum(ch.isalpha() for ch in t)
    money = len(re.findall(r"\$?\s*\d+[.,]\d{2}", t))
    has_total = 3 if re.search(r"\btotal\b", t, re.IGNORECASE) else 0
    has_subtotal = 2 if re.search(r"\bsub\s*total\b|\bsubtotal\b", t, re.IGNORECASE) else 0

    # Avoid weird garbage where letters are near zero
    alpha_ratio = (letters / max(1, len(t)))
    penalty = 0
    if alpha_ratio < 0.08 and len(t) > 80:
        penalty = 8

    return (2.0 * money) + (0.6 * len(lines)) + (0.03 * digits) + has_total + has_subtotal - penalty


def ocr_with_conf(image_bytes: bytes) -> Dict[str, Any]:
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    gray = _to_gray(pil)
    gray = _resize_for_ocr(gray)
    gray = _normalize_contrast(gray)
    gray = _denoise_and_sharpen(gray)

    # Build candidates: (variant_name, processed_img)
    candidates: List[Tuple[str, np.ndarray]] = []
    for idx, thr in enumerate(_binarize_variants(gray)):
        thr2 = _deskew(thr)
        candidates.append((f"bin_{idx}_deskew", thr2))

    # Try multiple PSMs; receipts often best with 6 or 11 (sparse text)
    psms = [6, 11, 4, 3]

    best = {"score": -1e9, "text": "", "words": [], "psm": None, "variant": None}

    for vname, proc in candidates:
        for psm in psms:
            text, words = _ocr_once(proc, psm=psm)
            sc = _score_text(text)
            if sc > best["score"]:
                best = {"score": sc, "text": text, "words": words, "psm": psm, "variant": vname}

    return {
        "text": best["text"],
        "words": best["words"],
        "debug": {
            "chosen_psm": best["psm"],
            "chosen_variant": best["variant"],
            "score": best["score"],
        }
    }
