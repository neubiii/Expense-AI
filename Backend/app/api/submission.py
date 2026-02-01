from fastapi import APIRouter
from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Dict, Any

from app.db.database import get_session
from app.db.models import SubmissionRecord, AuditEvent

router = APIRouter()

class SubmissionRequest(BaseModel):
    receipt_id: str
    final_fields: Dict[str, Any]
    user_confirmed: bool = Field(default=False)
    policy_rule_ids: List[str] = Field(default_factory=list)
    issues: List[Dict[str, Any]] = Field(default_factory=list)
    review_state: str  # GREEN / YELLOW / RED
    edits: List[Dict[str, Any]] = Field(default_factory=list)

@router.post("/submission/create")
def create_submission(req: SubmissionRequest):
    if not req.user_confirmed:
        return {"status": "BLOCKED", "reason": "User confirmation required."}

    session = get_session()
    try:
        submission = SubmissionRecord(
            receipt_id=req.receipt_id,
            review_state=req.review_state,
            final_fields=req.final_fields,
            policy_rule_ids=req.policy_rule_ids,
            created_at=datetime.utcnow().isoformat(),
        )
        session.add(submission)
        session.flush()

        audit = AuditEvent(
            submission_id=submission.id,
            event_type="SUBMITTED",
            payload={
                "issues": req.issues,
                "edits": req.edits,
                "policy_rule_ids": req.policy_rule_ids,
                "review_state": req.review_state
            },
            created_at=datetime.utcnow().isoformat()
        )
        session.add(audit)

        session.commit()
        return {"status": "SUBMITTED", "submission_id": submission.id}
    finally:
        session.close()
