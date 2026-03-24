from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.ocr_tesseract import ocr_with_conf
from app.services.receipt_parser import parse_receipt_fields

router = APIRouter()

@router.post("/extract")
async def extract(receipt: UploadFile = File(...)):
    if receipt.content_type not in {"image/png", "image/jpeg", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Upload a PNG/JPEG image.")

    image_bytes = await receipt.read()
    ocr = ocr_with_conf(image_bytes)  # {text, words:[{text, conf}]}

    parsed = parse_receipt_fields(ocr["text"], ocr["words"])

    # Print to terminal (debug transparency)
    print("\n========== OCR TEXT (first 1200 chars) ==========")
    print((ocr["text"] or "")[:1200])
    print("========== PARSED FIELDS ==========")
    for k, v in parsed["fields"].items():
        print(f"{k}: {v.get('value')} (conf={v.get('confidence')})")
    print("================================================\n")

    return {
        "receipt_id": parsed["receipt_id"],
        "fields": parsed["fields"],
        # If you REALLY want it hidden from UI, keep this commented out:
        # "raw_text_preview": ocr["text"][:800]
    }
