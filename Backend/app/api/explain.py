from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Any, List

from app.services.mock_explainer import mock_explain_with_policy

router = APIRouter()

class ExplainRequest(BaseModel):
    fields: Dict[str, Any]
    issues: List[Dict[str, Any]]
    rule_summaries: List[Dict[str, Any]] = []
    user_question: str

@router.post("/explain")
def explain(req: ExplainRequest):
    return mock_explain_with_policy(
        fields=req.fields,
        issues=req.issues,
        rule_summaries=req.rule_summaries,
        user_question=req.user_question
    )
