from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.ocr_tesseract import ocr_with_conf
from app.services.receipt_parser import parse_receipt_fields

router = APIRouter()

@router.post("/extract")
async def extract(receipt: UploadFile = File(...)):
    if receipt.content_type not in {"image/png", "image/jpeg", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Upload a PNG/JPEG image.")

    image_bytes = await receipt.read()
    ocr = ocr_with_conf(image_bytes)  # returns {text, words:[{text, conf}], ...}

    fields = parse_receipt_fields(ocr["text"], ocr["words"])
    return {
        "receipt_id": fields["receipt_id"],
        "fields": fields["fields"],
        "raw_text_preview": ocr["text"][:800]
    }
