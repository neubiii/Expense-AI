from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, Text
import json

class Base(DeclarativeBase):
    pass

class SubmissionRecord(Base):
    __tablename__ = "submissions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    receipt_id: Mapped[str] = mapped_column(String, index=True)
    review_state: Mapped[str] = mapped_column(String)
    final_fields_json: Mapped[str] = mapped_column(Text)
    policy_rule_ids_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String)

    def __init__(self, receipt_id, review_state, final_fields, policy_rule_ids, created_at):
        self.receipt_id = receipt_id
        self.review_state = review_state
        self.final_fields_json = json.dumps(final_fields)
        self.policy_rule_ids_json = json.dumps(policy_rule_ids)
        self.created_at = created_at

class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(Integer, index=True)
    event_type: Mapped[str] = mapped_column(String)
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String)

    def __init__(self, submission_id, event_type, payload, created_at):
        self.submission_id = submission_id
        self.event_type = event_type
        self.payload_json = json.dumps(payload)
        self.created_at = created_at
