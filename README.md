# AI-Assisted Expense Management (Human-in-the-Loop)

Project exploring a **human-centered AI-assisted expense submission system**.
The system combines OCR-based extraction, deterministic policy validation, and transparent explanations
to support user control and calibrated trust.

## Key Features
- Receipt upload with OCR-based field extraction (merchant, date, total, currency)
- Confidence-aware UI (GREEN / YELLOW / RED states)
- Deterministic policy engine with rule IDs and evidence
- Policy-grounded explanations and clarification questions
- Explicit human confirmation before submission (HITL)
- End-to-end working prototype (Frontend + Backend)

## Tech Stack
**Frontend**
- React + TypeScript
- Human-centered UI patterns for AI-assisted workflows

**Backend**
- FastAPI (Python)
- Tesseract OCR (local)
- Rule-based policy engine
- SQLite (local prototype storage)

## Architecture
The system follows a Sense–Plan–Act pattern:
- Sense: OCR extracts receipt text and confidence
- Plan: deterministic policy evaluation
- Act: explanation, clarification, and human confirmation

## Status
🚧 Active development

## Disclaimer
This project is a research prototype and not a production-ready system.
