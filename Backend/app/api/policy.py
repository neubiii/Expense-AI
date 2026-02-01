from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any
from app.services.policy_engine import validate_policy

router = APIRouter()

class PolicyRequest(BaseModel):
    receipt_id: str
    fields: Dict[str, Any]
    user_context: Optional[Dict[str, Any]] = None

@router.post("/policy/validate")
def validate(req: PolicyRequest):
    return validate_policy(req.receipt_id, req.fields, req.user_context or {})
