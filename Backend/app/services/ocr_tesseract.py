import io
from typing import Dict, Any, List, Tuple

import numpy as np
import cv2
from PIL import Image
import pytesseract

# OPTIONAL: if not on PATH, set this
pytesseract.pytesseract.tesseract_cmd = r"E:\Thesis-SRH\tesseract.exe"


def _preprocess(pil_img: Image.Image) -> np.ndarray:
    img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Upscale improves small receipt fonts
    gray = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)

    # Light denoise
    gray = cv2.bilateralFilter(gray, 9, 75, 75)

    # Threshold
    thr = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31, 2
    )

    # Morph close small gaps
    kernel = np.ones((2, 2), np.uint8)
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, kernel, iterations=1)
    return thr


def _ocr_once(proc: np.ndarray, psm: int) -> Tuple[str, List[Dict[str, Any]]]:
    config = f"--oem 3 --psm {psm} -l eng"

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


def _score_text(text: str) -> int:
    """
    Simple heuristic: more digits + more lines usually means better receipt OCR.
    """
    digits = sum(ch.isdigit() for ch in text)
    lines = len([l for l in text.splitlines() if l.strip()])
    money = len(list(__import__("re").finditer(r"\d+[.,]\d{2}", text)))
    return digits + 2 * lines + 3 * money


def ocr_with_conf(image_bytes: bytes) -> Dict[str, Any]:
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    proc = _preprocess(pil)

    # Try two layouts
    text6, words6 = _ocr_once(proc, psm=6)
    text4, words4 = _ocr_once(proc, psm=4)

    # Pick the better one
    if _score_text(text4) > _score_text(text6):
        return {"text": text4, "words": words4}
    return {"text": text6, "words": words6}
